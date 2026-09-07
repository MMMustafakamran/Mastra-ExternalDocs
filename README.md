# Mastra · CopilotKit — external-docs QA harness

Tests **Mastra's own** CopilotKit guide. Not CopilotKit's Mastra docs — the
sibling repo `../../Mastra-react` covers those.

**Doc** <https://mastra.ai/guides/build-your-ui/copilotkit/overview> — **one page**
**Snapshot** 2026-09-07 · `doc-snapshot/`
**Verdict** ✅ **Every published snippet is correct.** The gap is what is *not* published.
→ [`doc-snapshot/reports/FINDINGS.md`](doc-snapshot/reports/FINDINGS.md)

---

## 1 · What this repo is

A QA harness, not a demo app. Every snippet is pasted in **verbatim**, and the
job is to find where the guide is wrong.

Nothing it publishes is wrong. What it does not publish is the report: four
snippets import files the page never shows, the `agents` map the frontend is
told to match appears zero times, and three of the four hook-using snippets need
a `"use client"` the page never mentions.

**Scope note.** The assignment says "all pages in this section". There is one
page. Its content is also served byte-identical at
`mastra.ai/integrations/agentic-ui/copilotkit` — verified by diffing the two
markdown responses. So the routes here are *sections* of one guide, addressed by
anchor.

## 2 · Architecture

```
mastra.ai guide  ──►  mastra-server/  (Mastra + registerCopilotKit)  ──►  OpenAI
                              ▲
                              │  POST /copilotkit          :4111
                    Next.js frontend  ──►  CopilotChat + hooks
```

Backend: Node/TypeScript, `@mastra/core` + `@ag-ui/mastra`, run by `mastra dev`.
Frontend: Next.js App Router, CopilotKit — **both** v1 and v2 entrypoints,
because the page alternates between them (finding 4).

The folder is `mastra-server/`, not `backend/`, because that is the page's own
layout: it sketches `project-root/{mastra-server, my-copilot-app}`.

## 3 · What is doc code and what is not

Three of five server files and two of two components are harness code, and that
ratio *is* the finding:

| File | Source |
|---|---|
| `mastra-server/src/mastra/index.ts` | Page, **three blocks joined** — never shown whole |
| `mastra-server/src/mastra/agents/weather-agent.ts` | Page, verbatim |
| `mastra-server/src/mastra/tools/weather-tool.ts` | **Harness** — imported by the published agent, never published |
| `mastra-server/src/mastra/agents/bg-color-agent.ts` | **Harness** — described in one sentence |
| `mastra-server/src/mastra/agents/planning-agent.ts` | **Harness** — only its name appears |
| `frontend/src/app/*/demo-chat/page.tsx` | Page, verbatim (+ `"use client"`, see below) |
| `frontend/src/components/weather.tsx` | **Harness** — `<Weather {...result} />` with no stated shape |
| `frontend/src/components/steps-feedback.tsx` | **Harness** — specified in one paragraph |

Every harness file is written *only* from what the page says, and its header
quotes the sentence it was written from. That is the experiment: a component
built from the prose alone either works, or the prose was insufficient.

## 4 · Prerequisites & setup

| Thing | Version |
|---|---|
| Node.js | ≥ 18.18 |
| `OPENAI_API_KEY` | the snippets' model is `openai/gpt-5.6-sol` |

The page says only *"Ensure that you have set the appropriate environment
variables for your LLM provider"* and never names one.

```bash
cp .env.example .env          # fill in OPENAI_API_KEY
cd mastra-server && npm install && cd ..
cd frontend      && npm install && cd ..
cd autorecorder  && npm install && npx playwright install chromium && cd ..
```

**Ports.** Mastra **4111** is the page's own default and must not move — every
published frontend snippet hardcodes
`runtimeUrl="http://localhost:4111/copilotkit"`. Frontend **3303** is ours,
because eleven sibling repos default to 3000.

## 5 · Running it

```bash
npm run agent     # mastra-server  → http://localhost:4111
npm run dev       # frontend       → http://localhost:3303
```

## 6 · What to expect

| Route | Section | Try | Pass | Fail |
|---|---|---|---|---|
| `/quickstart/demo-chat` | Integration guide | `What is the weather in Lisbon?` | A streamed answer with real numbers | Nothing streams — check `:4111` and CORS |
| `/tool-rendering/demo-chat` | Controlled → Tool call rendering | `What is the weather in Reykjavik?` | "Retrieving weather…" **then** a weather card | A card with every field `--`, or no card at all |
| `/frontend-tools/demo-chat` | App control → Frontend tools | `Change the background to a deep navy blue.` | The page background actually changes | The agent says it changed and `--background` is untouched |
| `/human-in-the-loop/demo-chat` | App control → HITL | `Plan a three-step launch checklist.` | The run **suspends** on a step list with Continue/Reject | No card — the run never paused |

Two of these need a check no reply text can give:

- **Frontend tools** is a CSS custom property. The agent will happily say "Done"
  whether or not the handler ran, so `actions/frontend-tool.action.ts` reads
  `--background` off `document.body` before and after.
- **Human-in-the-loop** is supposed to *stop*. Waiting for a completed reply
  would time out on a working feature and pass on a broken one, so
  `actions/hitl.action.ts` waits for the approval card, edits a step, clicks
  Continue, and only then waits for completion.

## 7 · Status

| Section | Route | Status | Notes |
|---|---|---|---|
| Integration guide | `/quickstart/demo-chat` | ✅ Working | Works without `"use client"` — see finding 3 |
| Chat UI options | — | 🚧 Not recorded | Same props, different surface |
| Controlled → Tool call rendering | `/tool-rendering/demo-chat` | ⚠️ Partial | Imports a tool and a component neither of which is published |
| Controlled → Components as tools | — | 🚧 Not recorded | `useComponent`, v2-only |
| Controlled → State rendering | — | 🚧 Not recorded | Needs an agent with working memory |
| Declarative (A2UI) | — | 🚧 Not recorded | Imports `./a2ui-catalog`, never published |
| Open-ended (MCP Apps) | — | 🚧 Not recorded | Needs an MCP server on `:3108` |
| Frontend tools | `/frontend-tools/demo-chat` | ⚠️ Partial | Agent described in one sentence |
| Human-in-the-loop | `/human-in-the-loop/demo-chat` | ⚠️ Partial | `StepsFeedback` never published |
| Channels | — | 🚧 Not recorded | Needs a Slack app |
| Deployment | — | ✅ Implemented | `bundler.externals` in `mastra-server/src/mastra/index.ts` |

## 8 · Known issues

Full argument in [`FINDINGS.md`](doc-snapshot/reports/FINDINGS.md):

1. **The `agents` map is never shown.** The page says the `agent` prop "must
   match a key in your Mastra instance's `agents` map"; `agents:` appears zero
   times. Its own example passes `agent="weatherAgent"` against an agent whose
   `id` is `weather-agent` — matching neither `id` nor `name`.
2. **Four snippets import files the page never publishes.** `<Weather {...result} />`
   spreads a tool result whose shape is stated nowhere.
3. **Three snippets need `"use client"` and never say so** — while the first one
   genuinely does not, which sets the wrong expectation.
4. **v1 and v2 imports alternate between adjacent sections**, flagged once and
   never unflagged.
5. **`resourceId` is given two meanings** — agent selector in the example,
   memory scope in the options table.

## 9 · Recording

```bash
npm run record:doctor
npm run record -- --tool-rendering
npm run record                   # all four
```

Each clip is: the guide scrolled to its anchor → VS Code showing the exact lines
→ the live feature. **No Notepad** — the snippets work, and a note on a passing
page trains people to ignore notes.

Clips land in `autorecorder/videos/` as `MASTRA-ext-<NN>-<Name>.webm`, gitignored
as build output.

## 10 · Drift

```bash
npm run drift
npm run drift:sync
```

The five findings are all readings of the snapshot and re-check in seconds:

```bash
cd doc-snapshot/pages
grep -c 'agents:' *.md                                   # finding 1 → 0
grep -n "from '@/components/\|from '../tools/" *.md      # finding 2 → 3 hits
grep -c 'use client' *.md                                # finding 3 → 0
grep -c "react-core/v2'" *.md; grep -c "react-core'" *.md # finding 4 → 4 and 4
grep -n 'resourceId' *.md                                # finding 5 → 3 hits
```

## 11 · Project structure

```
mastra-server/src/mastra/
  index.ts              registerCopilotKit + CORS + bundler.externals
  agents/               weather (published) · bg-color · planning (harness)
  tools/weather-tool.ts harness — the unpublished half of the tool-rendering pair
frontend/src/
  app/<section>/demo-chat/page.tsx   one per recorded section, verbatim
  components/                        weather · steps-feedback (both harness)
```

## 12 · References

- [CopilotKit guide](https://mastra.ai/guides/build-your-ui/copilotkit/overview) — the page under test
- [Same content, second URL](https://mastra.ai/integrations/agentic-ui/copilotkit)
- [Mastra UI Dojo](https://ui-dojo.mastra.ai/) — where the page defers its unpublished components
- [AG-UI protocol](https://docs.ag-ui.com/)
