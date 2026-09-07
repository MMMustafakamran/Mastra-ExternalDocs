# Autorecorder

Automated screen-recording suite for CopilotKit framework integrations. It
produces one narrated-looking demo video per documentation page: read the doc,
switch to VS Code and show the code that implements it, switch to the browser and
drive the live feature.

Currently configured for **Microsoft Agent Framework (Python) + React**.

> **Porting this to another framework?** Read **[ADAPT.md](ADAPT.md)** first. It
> is written for the person or agent doing the port, and it is the contract the
> `doctor` command enforces.

---

## Run it

Both services must be up first — the recorder refuses to start otherwise, because
a video of a dead page is worse than no video.

```bash
cd backend  && uv run --prerelease=allow main.py     # :8000
cd frontend && npm run dev                           # :3000
```

Then:

```bash
cd autorecorder
npm install
npx playwright install chromium

npm run doctor            # is the configuration sane?
npm run record -- --list  # what will be recorded
npm run record -- --quickstart
npm run record            # all pages, in order
```

| Flag | Effect |
|---|---|
| `--list`, `-l` | Print every registered route and exit |
| `--help`, `-h` | Print the flags and exit |
| `--doctor` | Validate the configuration; exits 1 on error |
| `--doctor --online` | Also probe every doc/demo URL and the selectors |
| `--<page-id>` | Record one page — `--quickstart`, `--slots` |
| `--page=<id>` | Same thing, explicit form |
| `--pages=<id,id>` | Exactly these pages (`--only=` is an alias) |
| `--filter=<query>` | Record every page whose id or name contains the query |
| `--limit=<n>` | First *n* of the selection (`--first=`, `--count=`) |
| `--shard=<k>/<n>` | Slice *k* of *n*, for matrix workers |
| `--force` | Record even if the pre-flight health check fails |
| `--allow-ci` | On a runner, still record pages that boot their own dev server |

Every run also writes `videos/RECORD_RESULTS.json` — one entry per page with
pass/fail, the notes, the browser console errors and the file it wrote. The CI
report is built from that file, not from whatever `.webm` files happen to be
in the folder.

```bash
npm run check             # typecheck + unit tests + core/ drift check
npm test                  # just the unit tests (screen parsing, cast pacing, page selection)
npm run core:check        # core/ still matches core/CORE_MANIFEST.json
```

For the scaffolding CLI itself — a separate pipeline, no services needed — see
[Recording the CLI](#recording-the-cli).

Videos land in `videos/` as `<videoPrefix>-<NN>-<name>.webm`, 1920×1080, ~25fps
(Playwright's capture rate; it is not configurable).

**`videos/` is gitignored on purpose.** Recordings are build output — reproducible
from this folder plus `npm run record` — and committing them is expensive: 17 clips
at ~5MB, rewritten on every re-record, took one repo's `.git` to 348MB before its
history had to be rewritten. Publish them as release assets or to a bucket. Keep
this policy when you copy the folder into another repo.

---

## Reading the summary

```
   ✅ [PASS]  (24.1s) Quickstart -> MSPY-react-01-Quickstart.webm
   ⚠️  [PASS*] (31.7s) Inspector -> MSPY-react-06-Inspector.webm
        · Doc page (…/inspector): Timeout 25000ms exceeded
   ⚠️  [PASS*] (28.0s) Generative UI - Tool Rendering -> MSPY-react-09-ToolRendering.webm
        · [Tool Rendering] "Called the weather API for" never appeared. The reply streamed, but the useRenderTool component did not mount
   ❌ [FAIL]  (19.4s) AG-UI -> MSPY-react-17-AgUi.webm
        · Demo step failed: Agent never produced a response within 30s
```

- **PASS** — every step completed and everything the handler checked for was
  on screen.
- **PASS\*** — recorded, with a note. Either the external doc page misbehaved
  (intro footage degraded, feature not implicated) or the handler did not see
  something the doc promises — a renderer that never mounted, a state panel
  that stayed empty, a browser console error. The video is still the evidence;
  the note says what to look for in it.
- **FAIL** — the demo route 404'd, never rendered a chat surface, the agent never
  answered, the IDE view could not be built, or the handler called `ctx.fail`
  (an approval card that never appeared, a button that was not there to click).
  The clip is still saved. The process exits 1, so this is safe to gate CI on.

Handlers report through `ctx.warn` / `ctx.fail` (see `actions/index.ts`). A
`console.log` in a handler reaches the terminal and nothing else.

---

## Layout

The split between what you edit and what you don't is the point of this folder.

```
autorecorder/
├── ADAPT.md                    ← how to port this; read before editing
├── cli.ts                      ← entrypoint, arg parsing, summary
├── cli-capture.ts              ← runs terminal flows, writes casts
├── cli-render.ts               ← films a captured cast
│
├── config/                     ← ★ THE ADAPTATION SURFACE
│   ├── project.config.ts         framework slug, doc root, URLs, start commands
│   ├── pages.config.ts           one entry per doc page
│   ├── selectors.config.ts       how to find the chat surface
│   └── cli.config.ts             this framework's terminal flows
│
├── actions/                    ← ★ what to DO on each page
│   ├── index.ts                  page id → handler registry
│   └── *.action.ts               per-page interaction scripts
│
├── core/                       ← ✖ DO NOT EDIT — no framework knowledge here
│   ├── CORE_MANIFEST.json        hash of every core file; `npm run core:check`
│   ├── engine.ts                 browser lifecycle, the 3-step sequence, pass/fail
│   ├── actions.ts                sendPrompt, response detection, standard action
│   ├── select.ts                 which pages a `record` invocation means
│   ├── timeouts.ts               every fixed wait, with project/page overrides
│   ├── console-capture.ts        browser console errors, kept for the result
│   ├── doctor.ts                 the adaptation contract, as a command
│   ├── diagnostics.ts            pre-flight health check
│   ├── types.ts                  PageDefinition → PageRecordConfig, ActionContext
│   ├── ide/generator.ts          VS Code simulator, Shiki-highlighted from disk
│   ├── cli/                      terminal capture and replay
│   │   ├── driver.ts               runs a CLI under a real PTY, answers prompts
│   │   ├── session.ts              the PTY itself, recording to a cast
│   │   ├── service.ts              starts a dev server, waits for ready, port check
│   │   ├── screen.ts               reads a repainting TUI out of a byte stream
│   │   ├── cast.ts                 asciinema v2 read/write and pacing
│   │   ├── terminal.ts             the terminal window that replays a cast
│   │   ├── distribute.ts           one scaffold → four package-manager copies
│   │   ├── versions.ts             VERSIONS.md from an installed tree
│   │   ├── audio.ts                narration mux via ffmpeg
│   │   ├── ci-guard.ts             capture/render refuse to run on a runner
│   │   ├── finding.ts              the written note for a failed install, from its report
│   │   └── flow.ts                 CliFlowDefinition → CliFlowConfig, onSuccess / onFailure
│   └── overlays/                 Windows 11 taskbar, cursor, Notepad, alert dialog
│       └── human.ts                seeded pacing: typing rhythm, jittered pauses, idle drift
│
├── scripts/core-manifest.mjs   ← writes/checks CORE_MANIFEST.json, diffs two copies
├── test/                       ← unit tests for the pure modules (`npm test`)
├── casts/                      ← captured terminal sessions (gitignored)
└── videos/                     ← output, plus RECORD_RESULTS.json per run
```

Every framework-specific value lives in `config/`. If something in `core/` needs
to change for a port, that is a bug in this folder — see ADAPT.md.

That rule is checked, not just stated: `core/CORE_MANIFEST.json` holds a hash
of every core file and `npm run core:check` fails when they differ. A
deliberate core change is followed by `npm run core:write`, and the manifest
diff is the list of what to port to the other repos. To see how two copies
differ: `node scripts/core-manifest.mjs --diff ../../Other-repo/autorecorder`.

---

## What a recording actually does

1. **Doc page** — opens the real documentation URL, waits for hydration, then
   scrolls at reading pace and rests the cursor on a code block. Clicks VS Code
   on the simulated taskbar.
2. **IDE** — renders the project's own source, read from disk and highlighted
   with Shiki, with the page's line range selected. Multi-tab pages switch tabs.
   Served from the frontend's origin via an intercepted route, so the doc page is
   fully unloaded rather than painted over. Clicks Chrome on the taskbar.
3. **Demo** — opens the chrome-free demo route, types the prompt, waits for the
   reply to finish streaming, and pauses for reading.

### What makes it read as a person

Every pace in a take comes from `core/overlays/human.ts`, seeded from the
page id. So the Quickstart clip and the Slots clip do not type, pause and
scroll in the same rhythm — but tonight's Quickstart clip is identical to
last night's, which keeps two recordings of the same page comparable.

- **Typing** has a person's rhythm everywhere it happens: the chat prompt, the
  Notepad note, and the command typed at the terminal prompt before its output
  starts. Jittered keystrokes, a beat after punctuation, the odd pause.
- **Scrolling** is in bursts: a few wheel notches, a reading pause, a few more,
  sometimes a nudge back up.
- **Pauses** vary by about a quarter around their nominal length.
- **The cursor** overshoots slightly on long travel and settles, hovers a
  variable moment before a click, drifts while a reply streams instead of
  freezing, and starts each take somewhere plausible rather than dead centre.
- **Windows** fade in over 180ms (IDE, terminal, Notepad) instead of cutting.

Two details worth knowing, because both were bugs once:

- Overlays are injected as children of `<html>`, which React owns on any App
  Router page. `ensureOverlays` installs a MutationObserver that re-attaches them
  if a render pass deletes them, and step 1 waits for hydration before scrolling
  so a remount cannot snap the page back to the top.
- Native `window.alert` dialogs are browser chrome, so video capture never sees
  them (and Playwright auto-dismisses them). The Frontend Tools page needs its
  alert visible to prove the handler ran in the browser, so its action installs
  a DOM replica of Chrome's dialog via `core/overlays/alert-dialog.ts` and
  clicks OK with the virtual cursor. Opt-in — no other page is affected.

- The Readables take ends with a simulated Windows 11 Notepad window
  (`core/overlays/notepad.ts`), opened from the taskbar and typed into
  character-by-character at human rhythm, holding the issue report for that
  page. Also opt-in per action.

- Playwright starts recording when the page is created, so the first navigation
  is dead footage. The doc URL is warmed in a throwaway page first, which cuts
  it roughly in half; removing the rest would need an ffmpeg trim in post.

---

## Recording the CLI

The scaffolding CLI is interactive — menus, arrow keys, a prompt that acts on a
single keystroke — so it cannot be driven by piping text at it. It runs under a
real pseudo-terminal (`node-pty`), and the session is replayed in a terminal
window for the camera.

### The videos

One clip of the CLI, then three per package manager, so one manager's set
tells its whole story without cross-referencing another:

| # | File | Shows |
|---|---|---|
| 1 | `<prefix>-CLI-Create.webm` | the doc page, then `npx copilotkit@latest create` answering every prompt. One clip, shared: the CLI ran once and the result was copied into all four folders |
| 2 | `<prefix>-<pm>-2-Install.webm` | that manager running `install` in its own folder — **always filmed, pass or fail**, so the install command itself can be checked |
| 3a | `<prefix>-<pm>-3-Demo.webm` | if the install **worked**: the doc page, VS Code with `package.json` + that manager's lockfile + the integration code, `<pm> run dev` booting, then the real app answering a prompt |
| 3b | `<prefix>-<pm>-3-Finding.webm` | if the install **failed**: the doc page, VS Code with the resolved versions and the manifest, the install failing in the terminal, then a Notepad note explaining it |

Which third clip a manager gets is decided by its install report, not by
hand. `npm run cli:videos` reads `casts/<pm>.report.json`: a failed install
gets the finding clip; a working one gets its demo recorded. The finding note
is built from the report (command, exit code, the last lines on screen) so a
failure nobody has looked at yet still produces a clip that names the error;
the hand-written analysis in `INSTALL_ANALYSIS` (`config/cli.config.ts`) is
appended underneath when there is one.

Video 3a is a recording of the running app, not a re-enactment: the dev server
filmed booting in the terminal is the same process that serves the page driven
in the next segment, and the reply on screen is a live agent round trip.

### The pipeline

```bash
npm run check                       # 1. typecheck, unit tests, core/ manifest

npm run capture -- --login          # 2. once — sign-in opens a browser; also
                                    #    proves the PTY works on this machine
npm run capture -- --scaffold       # 3. run the real CLI, once
npm run capture -- --distribute     # 4. copy it ×4, seed the model key

npm run capture -- --install-npm    # 5. install per manager; each one also
npm run capture -- --install-pnpm   #    writes that copy's VERSIONS.md
npm run capture -- --install-yarn
npm run capture -- --install-bun

npm run cli:videos                  # 6. ► every clip: CLI, four installs, and
                                    #    per manager the finding or the demo
```

`npm run render -- --list` shows, per manager, which third clip it will get.
`npm run render -- --all` films without recording the demos, and prints the
`record` command for the ones that succeeded.

**Capture and render are separate commands, and that split is the point.**

A CLI run scaffolds directories, installs packages, and may block on browser
sign-in — minutes of real, side-effecting work. Rendering is offline and takes
seconds. Keeping them apart means fixing a font size, a pace, or a doc page that
changed never re-runs `npm install` or asks anyone to sign in again. The cast is
also the QA artifact: it is text, so a CLI that changes its prompts under
`@latest` shows up as a diff instead of a mysteriously broken driver.

### How a flow answers prompts

`config/cli.config.ts` describes prompts, not keystrokes:

```ts
{
  label: 'Agent framework',
  waitFor: /Select agent framework/i,
  select: { label: 'Microsoft Agent Framework (Python)', max: 40 },
  keys: ['Enter'],
}
```

`select` walks the list until the highlighted row matches the label. It is never
"press Down twelve times" — the framework list holds 23 entries today and grows
with every integration CopilotKit ships, so a hardcoded count silently scaffolds
the wrong framework the day an entry is inserted above the target, and reports
success while doing it. `npm run doctor` rejects a step that sends more than one
arrow key without a `select`.

Three more things the driver gets right, each of which was a real failure mode:

- **Every action waits for its prompt**, never for a timer. An npx cache miss or
  a sign-in round trip moves a prompt by minutes.
- **The screen is read from the end of the stream.** A TUI repaints over itself,
  so the accumulated bytes contain every historical frame; matching the whole
  buffer answers questions about a screen that is no longer there.
- **`Enter` is sent only where a prompt wants it.** The dependency prompt acts on
  a single keypress; an extra `Enter` there leaks into the next prompt and
  answers it before it has painted.

Conditional prompts are marked `optional: true` and skipped when absent — npx
only offers to install an uncached package, and only 18 of the 23 frameworks'
starters offer a chat channel at all.

### One scaffold, four package managers

The CLI runs **once**. `--distribute` copies the result into `1-cli-testing/npm`,
`pnpm`, `yarn` and `bun`, excluding `node_modules`, and seeds the repo root
`.env` into each copy's `.env` and `agent/.env`. (The old `install-all.ps1`
seeded from `1-cli-testing/.env`, which holds no key at all.)

Running the CLI four times instead would make the *scaffold* a variable in a test
whose only subject is the install, so a difference between managers could not be
attributed to the manager. Seeding the key once, before the copy, is likewise
the difference between one placement and four chances to typo it — and it keeps
the key out of every recording, since the scaffold is created without one.

`--distribute` refuses to overwrite a directory that already exists unless given
`--force`. Those directories hold installed trees that are not in version
control, so replacing one is not a recoverable mistake.

### The demo recordings

`demo-npm`, `demo-pnpm`, `demo-yarn` and `demo-bun` are ordinary page recordings
with one addition: each declares a `devServer`. The engine then boots that
server before filming, replays its boot in a terminal between the IDE and the
demo, points the demo at its origin, and kills it afterwards — so the terminal
segment is genuinely the process serving the app in the next segment.

The IDE segment shows `package.json` and then that manager's own lockfile. The
manifest declares *ranges*, so on its own it cannot answer "which versions is
this?" — and the lockfile is where the answer is written down, per manager,
which is the one place four package managers can visibly differ. (`VERSIONS.md`,
the generated summary of the same thing, stays on the install and finding clips;
showing both here would say it twice before the app has appeared.)

Each runs on its own port (3121–3124), never 3000. The repo's own frontend
usually holds 3000, and a demo that quietly recorded against *that* would look
like a pass while proving nothing about the scaffold.

Not 3101–3104 either, and that is not superstition. This suite is copied into
every framework repo, so every copy of `pages.config.ts` started from the same
port range — and a sibling repo's scaffold left running on 3101 was enough for
`npm run dev` here to die with `EADDRINUSE` while the browser cheerfully filmed
*that other framework's app*, which of course never answered. Give each
framework repo its own range.

### Video 3, per manager

| Manager | Install | Video 3 | Notes |
|---|---|---|---|
| npm | ✅ | ✅ recorded | full round trip: dev server boots, agent replies |
| pnpm | ✅ after `--approve-pnpm` | ✅ recorded | pnpm 10 refuses untrusted build scripts and exits 1; `pnpm approve-builds --all` is captured as its own flow, then the install is re-run |
| yarn | ✅ | ✅ recorded | the cold turbopack compile used to overrun the demo navigation; `startService` now warms `originUrl + demoPath` inside the boot window, so the browser opens a page that is already compiled |
| bun | ❌ | finding clip | the Windows postinstall finding (`CLI_FINDING_VIDEOS`) |

Three things `startService` now does that it once did not, each of which had
produced a wrong-looking pass:

- **Warms the demo route** once `readyPattern` matches, so a route that
  compiles on first request compiles during the boot footage (240s budget)
  rather than inside the demo navigation (`demoNavMs`, 45s by default).
- **Checks the port is free** before spawning. A sibling repo's dev server on
  the same port used to become the subject of the recording while the real
  server died quietly.
- **Aborts on failure text** — `EADDRINUSE`, `address already in use`,
  `Cannot find module` — instead of matching `readyPattern` against a stream
  that contains both the error and enough noise to look ready. Override per
  page with `devServer.abortOn`.

The waits themselves are configuration now: `PROJECT.timeouts` in
`project.config.ts` for the project, `timeouts` on a page entry to override,
defaults in `core/timeouts.ts`.

The demo pages are marked `generated: true`, meaning their files exist only
after the pipeline has run. Before that the doctor reports them as warnings
rather than errors, and an unfiltered `npm run record` skips them with a note
saying how to produce them. Naming one explicitly still records it, and still
fails — which is the right answer to "record this specific thing that is
missing".

### Local only — enforced, not just documented

`npm run capture` and `npm run render` **refuse to run in CI** and exit 1.
`npm run record` additionally skips any page that boots its own dev server when
it detects a runner. The check looks for `GITHUB_ACTIONS`, `CI`, `BUILD_BUILDID`
or `GITLAB_CI`; `AUTORECORD_ALLOW_CI=1` or `--allow-ci` overrides it for
capture and render, and `--allow-ci` lifts the dev-server skip for record.

Four reasons, not one:

- **Sign-in is interactive.** Linking the app to an Intelligence project opens a
  browser and finishes back at the terminal. A runner cannot complete that, and
  the CLI refuses to run in a shell with no terminal rather than opening a
  browser it cannot finish with.
- **They are side-effecting** — scaffolding writes directories, and the installs
  fetch four dependency trees.
- **They spend a real account** — a hosted Intelligence project, and a real model
  key for the demos.
- **The failure would be misread.** A job that timed out waiting for a browser
  sign-in looks exactly like a broken CLI, which is the opposite of what this
  suite exists to report.

It refuses rather than skipping silently, because a job that quietly does
nothing is how a suite stays green while testing nothing. CI records doc pages
with `node ci/automate.mjs`, which calls `npm run record` and never touches the
CLI pipeline.

Run `--login` once up front and everything after it is deterministic.

### What is not automated, deliberately

The model API key is never typed into the CLI and never appears in a recording —
the scaffold is created without one and the key is placed into the project
afterwards.

---

## Troubleshooting

**`Aborting before launching a browser`** — a service is down. The message names
which one and the command to start it. `--force` overrides.

**A page fails with "Agent never produced a response within 30s"** — either the
demo is genuinely broken, or `selectors.config.ts → assistantMessage` does not
match this app's messages. Run `npm run doctor --online` to tell the two apart:
it now prints which alternative of each selector actually matched, and warns
when `assistantMessage` matches something before any reply exists. For an
agent that is slow rather than broken, raise `replyStartMs` on that page.

**A page passes with `PASS*` and a note from the handler** — the reply came,
but the thing the doc promises did not: read the note, then watch the clip at
that moment. Those notes are also in `videos/RECORD_RESULTS.json` and the CI
report.

**"Port 3121 is already in use"** — another dev server holds the port, usually
a sibling repo's scaffold left running. Stop it; the recorder refuses rather
than filming the wrong app.

**The IDE highlights the wrong lines** — the line range drifted. `npm run doctor`
names the file and where its markers actually are now.

**A recording passes but the video is wrong** — the doctor cannot see cursor
placement or highlight correctness. Watch it.
