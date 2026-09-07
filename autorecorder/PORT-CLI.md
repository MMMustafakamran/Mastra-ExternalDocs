# PORT-CLI.md — bring an older `autorecorder/` up to the CLI pipeline

Adds: recording `copilotkit create`, the four package-manager installs, and the
scaffolded app running. Read `ADAPT.md` first.

**This file is a map, not a spec.** The source of truth is the code in this
repo — open the files named below rather than trusting a summary of them.

---

## 1 · Copy verbatim

```
core/cli/**                 (13 modules)
core/CORE_MANIFEST.json     scripts/core-manifest.mjs   test/
cli-capture.ts  cli-render.ts
1-cli-testing/  (CLI-FLOW.md, .gitignore, *.ps1, *.bat)
```

After copying, `npm run core:check` must pass: it proves `core/` arrived
byte-for-byte. `npm run core:write` regenerates the manifest if you *had* to
change core — and that is a finding to report, not a step in a port.

`package.json` — add deps `node-pty ^1.1.0`, `@xterm/xterm ^6.0.0` and the
`capture` / `render` / `cli:videos` / `test` / `core:check` scripts. Copy them
from this repo's file.
Root `.gitignore` — add `autorecorder/casts/`.

node-pty ships prebuilds. If npm tries to compile it, report that; do not
install build tools.

## 2 · Merge — do not overwrite ⚠ this is where ports go wrong

Changed here, but **your copy may have changed too**:

```
core/engine.ts   core/types.ts   core/doctor.ts
core/overlays/taskbar.ts   cli.ts
```

Your repo may also hold files this one lacks (`manifest.ts`, extra overlays,
extra actions). **Diff both `core/` trees first and list everything you would
delete.** Keep it — it is work that was never ported back.

**Gate, before any CLI config exists:**

```
npm run typecheck        → 0
npm run doctor           → 0
npm run record -- --<an existing page id>   → [PASS]
```

Commit this on its own. A regression here must not be tangled with new config.

## 3 · Prove the machinery

```
npm install
npm run check            # typecheck, unit tests, core/ manifest
npm run capture -- --login
```

`--login` is the first real PTY run: if the driver cannot hold a terminal on
this machine, it fails here, before any scaffold or install has been spent.

## 4 · Rewrite `config/cli.config.ts`

Copy the **structure**, not the values. Run the CLI once by hand in
`1-cli-testing/`, record what it actually asked in `CLI-FLOW.md`, encode that.

| Setting | How to get it right |
|---|---|
| `FRAMEWORK_ROW` | Your repo's row from `npx copilotkit@latest framework list`. Must be a unique substring. **Name the row; never count arrow keys** — the doctor rejects counted arrows, and the list grows. |
| `INTELLIGENCE_PROJECT` | An existing project on the operator's account. |
| `APP_NAME`, `SCAFFOLD_DIR` | Leave as `app` / `1-cli-testing` so paths match across repos. |
| `expectFiles`, `CLI_DISTRIBUTION.envFiles` | `agent/` exists **only in Python-agent starters**. Node starters (Mastra, LangGraph JS, Claude SDK TS) have none — asserting it fails a scaffold that worked. |
| Chat-platform step | Keep `optional: true` either way — only 18 of 23 starters ask. |
| `doneWhen`, `abortOn`, `render` pacing | Same CLI everywhere. Unchanged. |
| `INSTALL_ANALYSIS`, `FINDING_AUDIO`, `audio/` | **Empty them.** The bun analysis is a backslash in a Python starter's `install:agent`; yours will differ. A failed install still gets a finding clip with a generated note; add analysis once you have it. |

## 5 · `DEMO_PAGES` in `config/pages.config.ts`

- ports: **pick a range no other repo uses**, never 3000 (the repo's own
  frontend holds 3000) and not 3101–3104 or 3121–3124, which earlier ports
  already took. Every copy of this folder that shared a range has collided
  with a sibling repo's dev server at least once; `startService` now refuses a
  port that is already answering, so the collision fails loudly instead of
  filming the other repo's app — but it still fails.
- `readyPattern` = what *that* starter's dev server prints when serving
- `extraTabs` paths = that starter's shape (Next: `src/app/page.tsx`)
- `prompt` = something its agent can actually answer
- keep `generated: true`

## 6 · Run it

```
npm run capture -- --login        # once per machine; opens a browser
npm run capture -- --scaffold     # the real CLI, driven
npm run capture -- --distribute   # copy ×4, seed the model key
npm run capture -- --install-npm  # then pnpm, yarn, bun
npm run cli:videos                # CLI clip, install clips, then per manager
                                  # the finding (failed) or the demo (worked)
```

Then **watch them**. The doctor cannot see that the IDE highlighted the wrong
lines.

## Traps

- **Capture and render are separate on purpose.** A re-shoot must never re-run
  the CLI or a sign-in. Don't merge them.
- **Scaffold once, copy four times.** Four scaffolds make the scaffold a
  variable in a test whose only subject is the install.
- **The picker selects the agent framework, not the frontend.** A `-react` and
  an `-angular` repo of the same framework get the same starter and therefore
  the same create/install footage. Decide up front whether to reuse or re-film.
- **Never edit `core/` for a framework-specific reason.** That is a finding to
  report — it means something leaked into shared code and every repo has it.

## Done

`npm run check` 0 (typecheck, unit tests, core manifest) · `doctor` 0 ·
videos watched · README status table updated.

**Report:** what your repo had that this one didn't · which prompts differed or
turned out conditional · whether the starter has `agent/` · the dev server's
real ready string · what the four managers did, pass or fail · anything that
made you want to edit `core/`.
