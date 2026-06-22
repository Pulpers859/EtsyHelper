# EtsyHelper Product Principles

A lightweight product-decision rubric so EtsyHelper stays **premium and simple**
as it grows. The biggest standing risk for this app is bloat — feature sprawl
that makes the console heavier without making a seller's day easier. This is the
gate every new feature passes through before it gets built.

Inspired by product-management skill packs (PRDs, prioritization, discovery,
kill criteria), trimmed to what a solo/small team actually needs.

## North star

> One calm console for Etsy seller operations: profile, catalog, buyers,
> content, trends, and AI guidance — without the seller juggling ten tabs.

Every feature should make a real seller's recurring work **faster, calmer, or
smarter**. If it doesn't, it's a distraction.

## What "premium and simple" means here

- **Premium:** considered defaults, clean UI (see `DESIGN.md`), reliable AI
  output, no half-built corners shipped.
- **Simple:** the seller reaches value in a few clicks; surface area stays small;
  each screen has one clear job.
- Simplicity is a feature. Removing friction beats adding capability.

## Feature intake gate

Before building anything non-trivial, answer these. If you can't, it's not ready.

1. **Job:** What recurring seller job does this speed up, calm, or sharpen?
2. **Who & how often:** Is this a daily/weekly need or a one-off nicety?
3. **Home:** Which existing module owns it (below)? If it needs a *new* module,
   that's a high bar — justify it.
4. **Simplicity tax:** What does this add to the UI, the data model, and ongoing
   maintenance? Is the value clearly worth that cost?
5. **Kill criteria:** What signal (no use after N weeks, fragile integration,
   confusing) means we remove it?

### Quick scoring

Rate **Impact** (seller value) and **Effort/complexity** 1–5.

- High impact, low effort → do it.
- High impact, high effort → slice to the smallest valuable version first.
- Low impact → default to **no**, regardless of effort.
- Adds meaningful UI/maintenance with unclear impact → **no**.

## Module map (prevent overlap & sprawl)

Each module has one job. New work should fit an existing one; resist spreading a
concern across modules.

- **Command Center** — the daily briefing / triage hub: what needs attention now.
- **Studio** — content creation: social posts, campaigns, listing copy, imagery.
- **Customers** — buyer messages: triage, sentiment, drafted replies.
- **Catalog** — inventory & listings: stock, pricing, optimization, ideas.
- **Growth** — trends, audience targeting, marketing/30-day plans.
- **Launchpad / connectors** — Etsy/Instagram auth and sync plumbing.

If a feature doesn't clearly belong to one of these, question whether it belongs
in EtsyHelper at all.

## Defaults: when to say no

- No feature that duplicates what Etsy already does well natively.
- No setting/toggle to paper over an unclear default — pick the right default.
- No integration we can't keep reliable (brittle scraping/session hacks).
- No "while we're here" scope creep — ship the slice that solves the job.

## Definition of done

A feature is done when it is wired end-to-end, matches `DESIGN.md`, handles the
empty/error/loading states, degrades gracefully when AI or a connector is
unavailable, and a seller can complete the job without a guide.
