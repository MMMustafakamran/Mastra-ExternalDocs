# mastra — Mastra's CopilotKit guide, external

**Under test** <https://mastra.ai/guides/build-your-ui/copilotkit/overview> — **one** page
**Verdict** ✅ Every published snippet is correct. The gap is what is *not* published.
Read [`doc-snapshot/reports/FINDINGS.md`](doc-snapshot/reports/FINDINGS.md) before changing anything here.

## One page, so routes are anchors

Mastra documents the whole integration on a single page (also served
byte-identical at `mastra.ai/integrations/agentic-ui/copilotkit`). So every
entry in `pages.config.ts` sets `docPath` to a `#anchor`, and the recorder opens
the same URL for each clip and scrolls to a different section. That is what a
reader actually does.

## The page publishes React in full and Mastra in fragments

That sentence is the whole report. Four snippets import files the page never
shows, so three of the five files under `mastra-server/` are harness code:

| File | Source |
|---|---|
| `mastra-server/src/mastra/index.ts` | Page, **three blocks joined** — it is never shown whole |
| `.../agents/weather-agent.ts` | Page, verbatim |
| `.../tools/weather-tool.ts` | **Harness** — imported by the published agent, never published |
| `.../agents/bg-color-agent.ts` | **Harness** — described in one sentence |
| `.../agents/planning-agent.ts` | **Harness** — only its name appears |
| `frontend/src/components/weather.tsx` | **Harness** — `<Weather {...result} />` with no stated shape |
| `frontend/src/components/steps-feedback.tsx` | **Harness** — specified in one paragraph |

Keep the harness files minimal and written *only* from what the page says. That
is the experiment: if a component built from the prose alone works, the prose
was sufficient. Adding anything the page does not imply destroys the evidence.

## Two subtleties worth not re-deriving

- **`bgColorAgent` and `planningAgent` have no `tools:` entry, deliberately.**
  `colorChangeTool` and `generate_task_steps` are *client* tools — registered in
  the browser, arriving on the AG-UI run input. Declaring them server-side would
  be the obvious wrong fix.
- **`"use client"` is required on three of the four routes but not the fourth.**
  CopilotKit's bundles carry the directive themselves, so the quickstart snippet
  works without one; the other three define a local `Chat()` that calls a hook,
  and that is the reader's own component. Finding 3.

## Working on this repo

```bash
npm run agent            # mastra-server on :4111 (the page's own port)
npm run dev              # frontend on :3303
npm run drift
npm run record:doctor
npm run record -- --human-in-the-loop
```

Note the human-in-the-loop action does **not** wait for a completed reply — the
feature under test is the run *suspending*. Waiting for completion would time
out on a working feature and pass on a broken one.

---

## What these repos are

Four QA harnesses under `2-externalDocs/`, one per framework whose **own**
documentation ships an AG-UI integration guide:

| Repo | Vendor docs under test | Verdict |
|---|---|---|
| `ag2/` | `docs.ag2.ai/docs/user-guide/ag-ui/` | working |
| `mastra/` | `mastra.ai/guides/build-your-ui/copilotkit/overview` | working |

`agno/` was deleted on 2026-09-14 and `mspy/` is not in this folder; both sets
of findings are archived in `2-externalDocs/README.md`.

They are the external-docs counterpart to the eleven repos in the parent folder,
which test `docs.copilotkit.ai`. **Findings do not transfer between the two
sets.** The same integration documented by two different vendors is two
different sets of pages with two different sets of bugs, and a finding filed
against the wrong one wastes everybody's time.

## The working rules

These are not style preferences. They are what makes a finding defensible.

1. **Snippets go in verbatim.** A snippet that fails as published *is* the
   finding. Do not fix it, do not tidy it, do not add the missing import. If you
   cannot resist, you have turned a bug report into a demo.
2. **Broken pages keep their broken implementation.** The clip exists to show
   the defect.
3. **Ambiguity is a defect.** Missing steps, undefined identifiers, unstated
   prerequisites, an "Expected Output" block the code cannot produce. Report it
   even if inference makes the page work — the reader following the page does
   not have your inference.
4. **Every finding pins installed against declared versions.** "It's broken" is
   not a finding. "It's broken on 1.2.2, released four days ago, and the page
   still says `--pre`" is.
5. **Check the whole surface a page claims.** Multi-language pivots, multi-tab
   package managers, and per-framework variants all hide pages that are complete
   in one view and empty in another.

## Before filing anything

Verify statically first, and say so in the report. A defect you can prove by
parsing the snapshot is worth more than one you inferred from a failed run,
because it survives every question about credentials, versions and environment.

The order that works:

```
1. Snapshot the page              doc-snapshot/pages/
2. Paste the snippet verbatim     the harness
3. Parse it                       does it even define what it uses?
4. Read it against its own        does the published code produce the
   "Expected Output"              output the page says it will?
5. Only then run it               the recording is evidence, not diagnosis
```

Findings 1, 2a and 4 in `mspy/` were all found at step 3 or 4. The original
human tester found two of them at step 5 and attributed them to the runtime.

## Recording

Two clip shapes, and which one a page gets is decided by the page, not by taste.

- **Demo** — doc page, the code in an IDE, the thing running and working. This
  is what a page that works gets. **No Notepad.**
- **Finding** — the same three segments, then a Notepad window typed into at
  human rhythm holding the written report. This is what a broken page gets.

A note on a passing page trains people to ignore notes. Do not add one.

The Notepad body is a summary; the full argument belongs in
`doc-snapshot/reports/FINDINGS.md`. Every character is typed on camera, so
length is measured in seconds of video.

## Editing the recorder

`autorecorder/core/**` is frozen. It holds no framework knowledge — every such
value comes from `config/`. If you believe a core change is needed, that is a
finding to report, not a change to make quietly: it means something
framework-specific leaked into shared code, and every repo using this folder has
the same problem.

`npm run core:check` enforces it against `core/CORE_MANIFEST.json`. To compare
two copies:

```bash
node autorecorder/scripts/core-manifest.mjs --diff ../../MsPy-react/autorecorder
```

What you may edit: `config/*.ts` and `actions/*.ts`. That is the whole surface.
Read `autorecorder/ADAPT.md` before touching either.

## Ports

Twelve repos share this workspace and several default to the same ports. Before
adding a service, check what is taken:

```bash
grep -rhoE '\b(3[0-9]{3}|4[0-9]{3}|7[0-9]{3}|8[0-9]{3}|9[0-9]{3})\b' */ci/lib/config.mjs ../*/ci/lib/config.mjs | sort -u
```

Where a doc hardcodes a port, **keep the doc's port** — rule 1 outranks
convenience, and the collision is itself worth knowing about. Where the repo
picks one, pick a free one and say why in a comment.

## Definition of done

```
drift check clean
  → changed snippets pasted in verbatim
  → static lint output matches the report
  → npm run record:doctor exits 0
  → every flow captured, every clip rendered
  → FINDINGS.md rebuilt
  → clips actually watched
```

The last one is not decorative. The doctor cannot see that the cursor rested
somewhere useless, that the IDE highlighted the wrong function, or that the
terminal scrolled the interesting line off screen before the camera got there.
