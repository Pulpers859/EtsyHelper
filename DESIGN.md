# EtsyHelper Design System

A short, enforceable description of EtsyHelper's visual language. The app is
largely AI-built, so this exists to keep new UI consistent and on-brand instead
of drifting toward generic AI defaults. When you add or change UI, match this.

Inspired by design-quality skill packs: the goal is intentional layout,
typography, spacing, and hierarchy — not decoration.

## Brand feel

Warm, calm, premium, operator-grade. EtsyHelper is a quiet console a busy seller
trusts, not a flashy dashboard. Favor restraint: whitespace, soft shadows, and
clear hierarchy over color and chrome.

## Typography

- **Display / body:** `Sora` (`--font-sans`). Headings are heavy — `font-black`
  / `font-extrabold`, tight tracking on large sizes (`tracking-tight`).
- **Mono / code / URLs:** `IBM Plex Mono` (`--font-mono`).
- **Eyebrow labels:** the signature label style is small, uppercase, wide-tracked,
  heavy: `text-[11px] font-black uppercase tracking-[0.24em] text-slate-500`.
  Use it for section kickers and field labels — do not invent new label styles.
- **Body copy:** `text-sm leading-6`/`leading-7 text-slate-600`. Keep line length
  comfortable; let text breathe.

## Color & tone

Surface is a warm cream gradient (defined on `body`); cards are white/translucent.

- Neutrals: `slate` ramp (`slate-950` for primary CTAs and headings, `slate-600`
  body, `slate-500` labels, `slate-200` borders).
- Semantic tones map 1:1 — keep them consistent:
  - `emerald` = success / healthy / ready
  - `amber` = attention / warning / opportunity
  - `rose` = danger / urgent / destructive
  - `indigo` = informational / neutral accent
- Use `StatusPill` (components/shell.tsx) for status — don't hand-roll badges.

## Shape & elevation

- Radius scale (pills + soft cards): `rounded-full` for controls/pills,
  `rounded-[1.7rem]` / `rounded-[1.8rem]` for inner cards, `rounded-[2rem]` for
  top-level section cards. Stay on this scale.
- Elevation: soft, low shadows. Section cards use the established
  `shadow-[0_25px_80px_-45px_rgba(15,23,42,0.35)]` with `backdrop-blur`; inner
  cards use `shadow-sm`. Avoid hard/dark drop shadows.

## Spacing & layout

- Generous, rhythmic spacing. Common steps: `gap-3`/`gap-4`, `p-5`/`p-6`,
  section margins `mt-5`/`mt-6`. Keep vertical rhythm consistent within a view.
- Prefer responsive grids (`grid gap-4 md:grid-cols-2`) over cramped rows.

## Components (reuse before inventing)

- **CTAs:** use `Button` (components/ui.tsx) — pill, uppercase, tracked, with
  built-in focus ring and disabled state. Variants: `primary` (default),
  `secondary`, `danger`, `ghost`.
- **Lighter actions:** `MiniActionButton` (sentence case, lighter weight).
- **Surfaces & content:** `SectionCard`, `MetricCard`, `PreviewCard`,
  `EmptyState`, `StatusPill`, `ProfileField`, `AvatarBadge` in
  components/shell.tsx.

If a primitive exists, use it. Add a new shared primitive only when a pattern
repeats across views — never copy a long class string a third time.

## Motion

`framer-motion` is available and used. Keep motion subtle and purposeful (gentle
fades/slides on mount, quick transitions). No bouncy, attention-grabbing
animation — it breaks the calm.

## Accessibility (non-negotiable)

- Every interactive control must have a visible keyboard-focus state. The global
  `:focus-visible` ring in `index.css` covers buttons/links/`role="button"`;
  don't strip it with `outline-none` on individual elements.
- Maintain text contrast (avoid `slate-400` for body text on light surfaces).
- Use real `<button>`/`<a>` semantics; if you must use a div, add `role` and
  keyboard handlers.
