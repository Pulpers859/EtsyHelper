<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

## Working principles & design system

Two short guides keep EtsyHelper premium and simple as it grows — read them
before adding features or UI:

- [`docs/PRODUCT_PRINCIPLES.md`](docs/PRODUCT_PRINCIPLES.md) — the feature-intake
  gate, module map, and "when to say no" defaults that protect against bloat.
- [`DESIGN.md`](DESIGN.md) — the design language (typography, color/tone, shape,
  spacing, components) so new UI stays consistent and on-brand.

## Source Of Truth

The active coding repo for EtsyHelper now lives at:

`C:\Dev\EtsyHelper`

Treat `C:\Users\Patrick's Computer\OneDrive - WV School of Osteopathic Medicine\Desktop\EtsyHelper` as a stale copy unless you explicitly need to inspect it.

View your app in AI Studio: https://ai.studio/apps/459c95a4-10b1-4def-8923-7e814b863a82

## Run Locally

**Prerequisites:** Node.js

### Easiest Windows launch

Double-click [Start-EtsyHelper.cmd](/C:/Dev/EtsyHelper/Start-EtsyHelper.cmd) in the project folder.

That launcher:
- starts from the correct project folder automatically
- installs dependencies if `node_modules` is missing
- runs the dev server
- lets the server fall forward to the next open port if `3000` is already in use

### PowerShell launch

From any folder, run:

```powershell
& "C:\Dev\EtsyHelper\Start-EtsyHelper.ps1"
```

### Manual launch

1. Open PowerShell in `C:\Dev\EtsyHelper`
2. Install dependencies:
   `npm install`
3. Populate your local secrets in `.env.local`
   - start from [.env.example](/C:/Dev/EtsyHelper/.env.example)
   - set at least `GEMINI_API_KEY` or `VITE_GEMINI_API_KEY`
4. Run the app:
   `npm run dev`

If port `3000` is already busy, EtsyHelper will now automatically choose the next open port and print the exact `http://localhost:PORT` URL in the terminal.

## Playwright Smoke Tests

Playwright is configured for EtsyHelper with a demo workspace so you can run useful UI smoke tests without logging into your personal accounts.

### Install browsers

```powershell
npm run playwright:install
```

### Run the smoke suite

```powershell
npm run test:e2e
```

Helpful variants:

```powershell
npm run test:e2e:headed
npm run test:e2e:ui
npm run test:e2e:report
```

### Manual demo workspace

You can also open the app in demo mode from the landing page or by visiting:

```text
http://localhost:3000/?demo=1
```

Playwright builds the app and runs it through an isolated production-style test server on port `3410`, so it does not depend on your normal local app session.
