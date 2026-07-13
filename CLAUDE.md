# Abyrx Tools — rules for every Claude session

This repo is Will's internal tools hub. It has ONE live product: the Abyrx
Tools artifact. Losing or regressing a tool is the worst possible outcome —
it has happened twice from sessions working off partial views of the code.
Follow these rules exactly.

## The five tools (never remove or regress any of them)

1. **Kaiser Billing** 🧾 — bill sheet PDFs → Bill-Only master `.xlsm`
2. **Price Quote Generator** 📄 — hospital + prices → ABYRX-template PDF
   (form fields have NO placeholder/example text — deliberate, keep it that way)
3. **Price Information** 💲 — facility code → approved products & prices
   ("Use Here" chip, expandable per-sister-facility dropdown)
4. **Kairuku Session** 🔐 — persistent Playwright login session for Kairuku
   (`scripts/kairuku/kairukuSessionManager.ts`, profile in `~/.abyrx-kairuku`)
5. **Demo Units** 📦 — shipping sheet photo → demo entries in Kairuku

Each tool exists in TWO places that must stay in sync:
- the React app: `src/tools/*.tsx` + `src/tools/registry.tsx`
- the standalone artifact page: `scripts/standalone/page.html` (+ `entry.ts`)

## Git rules

- **`main` is the single source of truth.** Start every session by fetching
  `origin/main` and branching from its tip. Never build on a stale base.
- Build each new tool on its own branch, but when the user approves the
  result, **merge back to `main` (ask first)** — a tool that lives only on a
  side branch WILL get clobbered by the next session.
- Before changing shared files (`registry.tsx`, `page.html`, `entry.ts`),
  run `git fetch origin` and check ALL remote branches for unmerged work
  (`git branch -r`, then `git log --oneline origin/<branch> --not origin/main`).
  If another branch has tool work that isn't in main, tell the user before
  proceeding.

## The live artifact (most important rule)

- URL: https://claude.ai/code/artifact/f1ab86bd-16e9-465a-be9f-6da5397bf384
- ALWAYS update this exact artifact via the Artifact tool's `url` parameter.
  NEVER create a new artifact for Abyrx Tools.
- ALWAYS rebuild it from repo source — never hand-edit the built file:
  ```bash
  node_modules/.bin/esbuild scripts/standalone/entry.ts --bundle \
    --format=iife --platform=browser --target=es2020 --minify \
    --outfile=scripts/standalone/bundle.js
  node scripts/standalone/build.mjs   # → scripts/standalone/abyrx-tools.html
  ```
- NEVER publish from a branch that is missing tools present on `main` or on
  the live artifact. Before publishing, open the built page in Chromium and
  confirm EVERY tool listed above appears and its tab renders.

## Verify before declaring done

```bash
npm run build && npm run lint && npm test        # 48+ unit tests must pass
node scripts/standalone/verify-quote.mjs         # Price Quote in Chromium
node scripts/standalone/verify-page.mjs          # Kaiser Billing in Chromium
node scripts/standalone/verify-price.mjs         # Price Information in Chromium
```

(In sandboxes whose Playwright browser revision mismatches, launch Chromium
with `executablePath: '/opt/pw-browsers/chromium'` or stage the expected
revision under `PLAYWRIGHT_BROWSERS_PATH`.)

## Kairuku specifics

- Kairuku Session and Demo Units need a real machine: they run through the
  local sidecar (`npm run kairuku:session`) or the double-click launchers
  (`Start Abyrx Tools.command` / `.bat`). The hosted artifact can only show
  status/instructions for them — that's by design, not a bug.
- Never store or log credentials, MFA codes, cookies, or tokens. The only
  persisted state is the Playwright profile in `~/.abyrx-kairuku`
  (gitignored, never committed, never uploaded).
- `requireKairukuSession()` in `scripts/kairuku/kairukuSessionManager.ts` is
  the entry point every new Kairuku tool must use.
