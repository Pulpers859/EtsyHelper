/**
 * Content ingest — inspired by Microsoft's MarkItDown.
 *
 * Buyer notes pasted from Etsy or email arrive as messy HTML, quoted reply
 * chains, and signature noise. Feeding that raw into Gemini (and storing it on
 * the conversation record) hurts triage quality and clutters the history. This
 * module normalizes pasted content into clean, LLM-friendly plain text before
 * it reaches the model or Firestore.
 *
 * Scope is deliberately narrow: it only covers the messy inputs the app
 * actually feeds to the AI today (HTML fragments and email threads). It does
 * not try to be a general file converter — that would be bloat until there is
 * a real import surface that needs it.
 */

const QUOTE_MARKERS: RegExp[] = [
  // Gmail / Apple Mail: "On Mon, Jan 1, 2026 at 9:00 AM Jane <jane@x.com> wrote:"
  /^\s*On .+ wrote:\s*$/im,
  // Outlook / generic divider
  /^-{2,}\s*Original Message\s*-{2,}\s*$/im,
  // Outlook header block
  /^\s*From:\s.+$/im,
  // Long horizontal rule Outlook injects between messages
  /^_{10,}\s*$/m,
];

const SIGNATURE_MARKERS: RegExp[] = [
  // Standard signature delimiter ("-- " on its own line)
  /^\s*--\s*$/m,
  /^\s*Sent from my (iPhone|iPad|Android|mobile device).*$/im,
  /^\s*Get Outlook for (iOS|Android).*$/im,
];

function decodeEntities(text: string): string {
  // In the browser, let the platform decode the full entity set correctly.
  if (typeof document !== 'undefined') {
    const el = document.createElement('textarea');
    el.innerHTML = text;
    return el.value;
  }
  // Node/SSR fallback covers the entities that actually show up in email HTML.
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'");
}

function looksLikeHtml(input: string): boolean {
  return /<\/?[a-z][^>]*>/i.test(input);
}

/** Convert an HTML fragment to readable plain text, preserving block breaks. */
export function htmlToText(html: string): string {
  if (!html) return '';

  const text = html
    // Drop script/style blocks entirely — never user-facing content.
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '')
    // List items become markdown bullets.
    .replace(/<li[^>]*>/gi, '\n- ')
    // Closing block tags and <br> become line breaks.
    .replace(/<\/(p|div|li|tr|h[1-6]|ul|ol|blockquote|table)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    // Strip everything else.
    .replace(/<[^>]+>/g, '');

  return decodeEntities(text);
}

/** Drop quoted reply history so only the buyer's newest message remains. */
export function stripQuotedReplies(text: string): string {
  let earliest = -1;
  for (const marker of QUOTE_MARKERS) {
    const match = marker.exec(text);
    if (match && (earliest === -1 || match.index < earliest)) {
      earliest = match.index;
    }
  }

  let result = earliest > -1 ? text.slice(0, earliest) : text;

  // Remove any straggling lines that are themselves quotes ("> ...").
  result = result
    .split('\n')
    .filter((line) => !/^\s*>/.test(line))
    .join('\n');

  return result;
}

/** Trim a trailing email signature block. */
export function stripSignature(text: string): string {
  let earliest = -1;
  for (const marker of SIGNATURE_MARKERS) {
    const match = marker.exec(text);
    if (match && (earliest === -1 || match.index < earliest)) {
      earliest = match.index;
    }
  }
  return earliest > -1 ? text.slice(0, earliest) : text;
}

/** Collapse whitespace into a calm, consistent shape. */
export function normalizeWhitespace(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    // Collapse runs of spaces/tabs (but not newlines).
    .replace(/[ \t]+/g, ' ')
    // Trim trailing spaces on each line.
    .replace(/[ \t]+\n/g, '\n')
    // Collapse 3+ blank lines into a single blank line.
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Main entry point: turn a raw pasted buyer message into clean text.
 *
 * Always returns the seller's content — if aggressive cleaning would strip
 * everything (e.g. the paste was entirely a quoted thread), it falls back to a
 * lightly normalized version of the original so no information is ever lost.
 */
export function cleanInboundMessage(raw: string): string {
  if (!raw || !raw.trim()) return '';

  const decoded = looksLikeHtml(raw) ? htmlToText(raw) : raw;
  const cleaned = normalizeWhitespace(stripSignature(stripQuotedReplies(decoded)));

  if (cleaned) return cleaned;

  // Safety net: never lose the message just because it was all quotes.
  return normalizeWhitespace(decoded);
}
