# EtsyHelper Project Handoff

## Project Identity
- Project name: `EtsyHelper`
- Project type: `web app`
- Source-of-truth repo path: `C:\Dev\EtsyHelper`
- Stale/old copies to ignore if applicable: `C:\Users\Patrick's Computer\OneDrive - WV School of Osteopathic Medicine\Desktop\EtsyHelper`
- Primary target for normal work if multiple surfaces exist: `both`
- GitHub intent/status: `unknown`
- GitHub remote: `none`

## Repo State
- Stable branch: `main`
- Working branch: `dev`
- Expected default branch for normal work: `dev`
- Sync-first rule: `Before normal work, fetch from the remote first. If the working tree is clean and the active branch tracks the expected upstream, pull with --ff-only before editing. If local changes exist, fetch and reconcile instead of blindly pulling.`
- If Git is not set up yet for this project, the agent should bootstrap it before doing major feature work.

## If No Git Exists Yet
If `git rev-parse --is-inside-work-tree` fails in the real project root, the agent should help set up the repo using this standard:
1. confirm the real project root
2. migrate the project to `C:\Dev\EtsyHelper` if the current location is a weak source of truth
3. initialize local Git
4. create a focused `.gitignore`
5. create `.gitattributes` enforcing LF for code files
6. set repo-local config:
   - `core.autocrlf=false`
   - `core.eol=lf`
   - `pull.ff=only`
   - `fetch.prune=true`
7. add repo-local aliases:
   - `git st` -> `status -sb`
   - `git lg` -> `log --oneline --graph --decorate --all --date=short`
8. create the initial commit
9. run a secret scan and remove any live credentials from tracked files before connecting/pushing GitHub
10. connect the GitHub remote if I want one
11. push `main`
12. create and push `dev`
13. add a local hook blocking direct commits to `main`
14. create a dedicated PowerShell shortcut for this project

If the GitHub remote is unknown, the agent should finish local bootstrap first and only ask for the remote when push/setup is actually needed.

## PowerShell / Terminal Standard
- Do not globally pin every PowerShell session to this project.
- A dedicated shortcut should exist:
  - `EtsyHelper PowerShell`
- That shortcut should open directly in the source-of-truth repo path.
- Avoid fragile startup command strings if the path contains apostrophes or quoting hazards.

## How The Agent Should Operate
- Inspect before assuming.
- Work in the source-of-truth repo only.
- Sync from GitHub before normal work so the local repo is not stale.
- Fix root causes, not surface symptoms.
- Be honest and direct.
- Prefer architecture/data-flow fixes over hacks.
- Do not use brittle hardcoded special cases or band-aid fixes unless you explicitly explain why a deeper fix is not practical.
- Be proactive: inspect, diagnose, edit code directly, verify, and then audit nearby weaknesses.
- Do not stop at the first fix if adjacent code is obviously fragile.
- Tell me clearly what is evidence-backed, proven, inferred, or heuristic.
- If validation, linting, or review logic is too rigid and rejects good output, improve the rule when appropriate instead of dumbing down the product.
- Do not silently tolerate poor architecture if it is now a maintenance risk.
- Handle Git operations when appropriate.
- Keep normal work on `dev`, not `main`.
- Before editing on an existing repo, run a fetch and check ahead/behind state; if clean, pull the tracked branch with `--ff-only`.
- Audit adjacent risks after making fixes.
- Run the checks that are realistically available in the current environment.
- Clearly distinguish evidence-backed logic from heuristics.
- Treat secrets as local-only by default: use tracked example files and ignored real config files whenever possible.

## Communication Style
- Warm, collaborative, calm, disciplined
- High-effort and thoughtful
- Short progress updates while working
- Clear reasoning, no fluff, no fake certainty
- If the agent misses something, it should own it directly

## Post-Fix Audit Standard
After making changes, the agent should do another harsh pass focused on:
- root-cause completeness
- adjacent fragility
- architecture quality
- validation or rule correctness
- progression / flow coherence where relevant
- silent failure risk
- wasted retries / wasted cost / wasted work
- maintainability

## What The User Wants By Default
- The user describes the problem in chat.
- The agent syncs from the tracked remote branch first so local files are current before investigation or edits.
- The agent investigates directly.
- The agent makes code changes directly.
- The agent audits adjacent risks.
- The agent runs local checks where possible.
- The agent handles Git steps when appropriate.
- The user should not need to babysit PowerShell, Git, or GitHub for normal work.

## Before Starting Any New Task
The agent should confirm:
1. current repo path
2. current branch
3. repo status cleanliness
4. remote configuration
5. whether the local branch is behind the remote and needs fetch/pull
6. whether stale copies exist elsewhere
7. whether the active folder is truly the source of truth

## Architecture / Product Notes
- Main product purpose: `EtsyHelper is an Etsy seller operations console that combines shop profile setup, inventory, buyer messaging, content scheduling, trend analysis, and AI-assisted task guidance in one local web app.`
- Key modules or directories: `App.tsx`, `server.ts`, `views/`, `components/`, `app/core.ts`, `app/localWorkspace.ts`, `services/gemini.ts`, `lib/firebase.ts`, `tests/`
- Known fragile areas: `Etsy and Instagram OAuth/session-secret configuration`, `state merging between Firestore data and local workspace fallback data`, `deployment/runtime assumptions inherited from the AI Studio export`, `generated temp artifacts that should stay untracked`
- Important evidence/product constraints: `The app supports localhost-only local workspace mode`, `Firebase web config is currently tracked via firebase-applet-config.json`, `Gemini features depend on local environment configuration`, `A stale OneDrive/Desktop copy exists and should not be used for active work`
- Runtime environments that matter: `local web`, `Express dev server`, `Firebase Auth/Firestore/Storage`, `Etsy OAuth/API`, `Instagram OAuth/API`, `Playwright smoke tests`

## Git / Release Notes
- Preferred everyday flow:
  - `git st`
  - `git diff`
  - `git add .`
  - `git commit -m "..."`
  - `git push`
- Preferred promotion flow from `dev` to `main`:
  - `git checkout main`
  - `git pull --ff-only`
  - `git merge --ff-only dev`
  - `git push`
  - `git checkout dev`

## Project-Specific Instructions For The Next Agent
```text
Project: EtsyHelper
Active repo path: C:\Dev\EtsyHelper
GitHub remote: none
Stable branch: main
Working branch: dev

Important:
- Treat C:\Dev\EtsyHelper as the source of truth.
- Do not work in C:\Users\Patrick's Computer\OneDrive - WV School of Osteopathic Medicine\Desktop\EtsyHelper unless explicitly asked to inspect the stale copy.
- If Git is not already set up, bootstrap it using the repo standard in this file before major feature work.
- Use the standard workflow: investigate directly, fix root causes, audit adjacent risks, run checks, and handle Git when appropriate.
- Before starting normal work, fetch from origin and sync the active branch first when the working tree is clean. If the repo is dirty, fetch and reconcile instead of pulling blindly.
- Prioritize both the React client and the Express/Firebase/OAuth server surface when tracing bugs because user-visible flows cross both.
- Keep generated artifacts, local secrets, and temporary research files out of version control.
- If the GitHub remote is unknown, finish local repo setup first and ask for the remote only when needed for push/setup.
```
