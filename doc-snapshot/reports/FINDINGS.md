# QA findings — Mastra, CopilotKit guide (external docs)

**Doc** <https://mastra.ai/guides/build-your-ui/copilotkit/overview>
**Snapshot taken** 2026-09-07 · 1 page · `doc-snapshot/pages/`
**Assignment said** ✅ Fully Working
**This run says** ✅ **Every published snippet is correct, and all four recorded sections work end to end.** The gap is what is *not* published: four snippets import files the page never shows.
**Recordings** 4 clips, `autorecorder/videos/MASTRA-ext-*.webm` — recorded 2026-09-07

## Versions pinned

| Package | Docs declare | Resolved 2026-09-07 |
|---|---|---|
| `@copilotkit/react-core` / `react-ui` | unpinned | 1.70.1 |
| `@ag-ui/mastra` | unpinned | 1.1.2 |
| `@ag-ui/core` / `@ag-ui/client` | unpinned | 0.0.59 |
| `@copilotkit/runtime` | unpinned | 1.70.1 |
| `@mastra/core` | unpinned | **1.64.0** |
| `@mastra/client-js` | unpinned | 1.43.0 |
| `mastra` (CLI) | not named on the page | 1.27.3 |
| `@mastra/core` | re-checked 2026-09-14 | installed here **1.64.0**; npm `latest` is now **1.66.0** |
| Model id in snippets | `openai/gpt-5.6-sol` | real — verified against the account's model list |

Every package on the page's install line is unpinned, and that turns out to
matter: `@ag-ui/mastra@1.1.2` declares peers `@ag-ui/core >=0.0.44` and
`@mastra/client-js >=1.0.0-0`, so any attempt to pin those to older majors
fails `npm install` outright with ERESOLVE. Unpinned resolution is the only
thing the page's command can mean, and it works.

## Scope note

The assignment says "all pages in this section". There is **one** page. Its
content is also served, byte-identical, at
`https://mastra.ai/integrations/agentic-ui/copilotkit` — verified by diffing the
two markdown responses. Only the second appears in `mastra.ai/llms.txt`.

## Re-verification — 2026-09-14

- **The page has not moved.** Re-fetched today: sha256
  `77052f4d…d331726`, 25 029 bytes, identical to the 2026-09-07 snapshot.
- **The sitemap still lists only the `/integrations/agentic-ui/copilotkit`
  URL**, not the `/guides/…/overview` one this repo tracks. That is now recorded
  as an alias in `doc-snapshot/manifest.json` rather than re-discovered as a
  removed page on every drift run.
- **`@mastra/core` moved 1.64.0 → 1.66.0** and the `createTool` execute
  signature did not: both declare
  `execute?: (params, options) => Promise<any>`, so finding 2's unpublished
  contract is unchanged. The harness itself has **not** been upgraded to 1.66,
  so nothing below has been re-run against it.
- **All four sections re-recorded today**, 4 of 4 passing.

So the "section" is one guide with two URLs, and the routes in this repo are
sections of it, addressed by anchor.

---

## Summary

| # | Scope | Verdict |
|---|---|---|
| 1 | [The `agents` map the frontend must match is never shown](#1--the-agents-map-every-snippet-depends-on-is-never-shown) | ⚠️ Ambiguity |
| 2 | [Four snippets import files the page does not publish](#2--four-snippets-import-files-the-page-never-publishes) | ⚠️ Ambiguity |
| 3 | [Hook-calling snippets need `"use client"` and never say so](#3--three-snippets-need-use-client-and-the-page-never-says-so) | ⚠️ Ambiguity |
| 4 | [v1 and v2 imports alternate between adjacent sections](#4--v1-and-v2-imports-alternate-between-adjacent-sections) | 💡 Suggestion |
| 5 | [`resourceId` is given two different meanings](#5--resourceid-is-given-two-different-meanings-on-one-page) | 💡 Suggestion |
| 6 | [The unpublished tool's `execute` signature is easy to get wrong](#6--the-unpublished-tools-execute-signature-fails-silently-when-guessed-wrong) | ⚠️ Consequence of 2 |
| 7 | [The progressive-rendering claim was not observed](#7--the-progressive-rendering-claim-was-not-observed) | ℹ️ Observation |

None of these is a broken snippet. Every identifier the page publishes resolves
against the current packages — checked by reading the type declarations, not by
assuming. The theme running through 1–3 is that the page publishes its **React**
surface completely and its **Mastra** surface in fragments.

---

## 1 · The `agents` map every snippet depends on is never shown

The frontend snippets all pass an `agent` prop, and the page explains it:

> The `agent` prop names the Mastra agent to route to. **It must match a key in
> your Mastra instance's `agents` map.**

That map is never displayed. The string `agents:` appears **zero times** on the
page. Both of its `new Mastra({...})` blocks omit it — the integration guide's
elides it behind a comment, and the Deployment one shows only `bundler`:

```typescript
export const mastra = new Mastra({
  // Rest of the configuration...      ← the agents map is in here
  server: {
    cors: { ... },
    apiRoutes: [registerCopilotKit({ path: '/copilotkit', resourceId: 'weatherAgent' })],
  },
})
```

So the reader is told to match a key in a structure the page does not show, in a
file it shows three partial versions of.

**Tested, and the page's value is correct.** Pointing a copy of the snippet at
`agent="weather-agent"` — the agent's `id`, which is what Mastra's own
`/api/agents` reports as its key — fails at runtime with:

```
Error: useAgent: Agent 'weather-agent' not found after runtime sync
  (runtimeUrl=http://localhost:4111/copilotkit).
  Known agents: [weatherAgent, planningAgent, bgColorAgent]
```

So `agent="weatherAgent"` is right and the map key is what counts. The defect is
purely that the reader is told to match a structure the page never shows — and
the example actively invites the wrong guess, because the published agent is:

```typescript
export const weatherAgent = new Agent({
  id: 'weather-agent',        // ← kebab
  name: 'Weather Agent',
  ...
})
```

and the frontend passes `agent="weatherAgent"` — camelCase, matching **neither**
`id` nor `name`. It matches the variable name, i.e. the map key. And
`/api/agents` on the running server keys the same agents by `id`
(`weather-agent`), so the one place a reader can go looking for the answer shows
them the form that does not work.

Across sections the page names three agents this way — `weatherAgent`,
`bgColorAgent`, `planningAgent` — and shows the map for none of them.

**Ask:** show the `agents: { weatherAgent }` line once, in the step-2 block, and
say explicitly that the prop takes the map key rather than the agent's `id`.

---

## 2 · Four snippets import files the page never publishes

| Section | Imports | Published? |
|---|---|---|
| Tool call rendering | `weatherTool` from `../tools/weather-tool` | ❌ |
| Tool call rendering | `Weather` from `@/components/weather` | ❌ |
| Human-in-the-loop | `StepsFeedback` from `@/components/steps-feedback` | ❌ |
| Frontend tools | the `bgColorAgent` it routes to | ❌ (one sentence) |

Two of the four are load-bearing rather than incidental.

**`Weather` + `weatherTool` share an unstated contract.** The published render
function is:

```tsx
render: ({ status, result }) => {
  if (status !== 'complete') return <div>Retrieving weather...</div>
  return <Weather {...result} />
}
```

`{...result}` spreads the tool's return value straight into the component as
props. So the tool's output shape *is* the component's prop list — and the page
publishes neither side of that. A reader has a renderer that will mount with
every prop `undefined` and no stated reason why.

**`StepsFeedback` is specified in prose and then deferred.** All the page says:

> Inside `StepsFeedback`, let the user toggle steps and then call
> `respond({ accepted: true, steps })` to resume the agent, or
> `respond({ accepted: false })` to reject. ... See the full component in the
> [UI Dojo].

That is enough to write one — `frontend/src/components/steps-feedback.tsx` in
this repo is written from exactly that paragraph and nothing else, which was the
test. But it is the only interactive component on the page, and the section is
about the interaction.

The remaining two are Mastra agents: the Frontend tools section says *"The
matching Mastra agent is a normal agent instructed to call `colorChangeTool`
with the requested color"* and the Human-in-the-loop section says nothing at all
about `planningAgent` beyond the prop.

Worth noting what *is* subtle and gets left implicit: neither of those agents
should declare the tool in its `tools:` map, because `colorChangeTool` and
`generate_task_steps` are **client** tools that arrive on the AG-UI run input
from the browser. That is exactly the thing a one-sentence description cannot
convey, and the thing a reader would get wrong first.

**Ask:** publish the two small components, or state the `result` shape the
renderer expects. For the agents, one short block showing that a client-tool
agent has no `tools:` entry would prevent the obvious mistake.

---

## 3 · Three snippets need `"use client"` and the page never says so

The page frames these as Next.js App Router files ("Open the home route of the
Next.js app (usually `app/page.tsx` or `src/app/page.tsx`)"), where a file is a
Server Component unless marked otherwise.

The distinction is not uniform, which is what makes it worth a finding:

| Section | Needs `"use client"`? | Why |
|---|---|---|
| Integration guide (step 5) | **No** | It renders only imported components. CopilotKit's bundles carry the directive themselves, so the boundary is on their side |
| Tool call rendering | **Yes** | Defines a local `Chat()` that calls `useRenderTool` |
| Frontend tools | **Yes** | Defines a local `Chat()` that calls `useFrontendTool` |
| Human-in-the-loop | **Yes** | Defines a local `Chat()` that calls `useHumanInTheLoop` |

Verified rather than assumed: `@copilotkit/react-core`, its `/v2` entrypoint and
`@copilotkit/react-ui` all begin with `"use client";` in their published
bundles. That is why the first snippet works as published — and why the other
three do not, since a component the *reader* writes is not covered by the
library's directive, and calling a hook from a Server Component throws.

So the page's first snippet sets the expectation that no directive is needed,
and the next three quietly require one.

**Ask:** add `"use client"` to the three snippets that define a local
hook-calling component. One line each.

---

## 4 · v1 and v2 imports alternate between adjacent sections

Within one page:

| Section | Provider imported from |
|---|---|
| Integration guide | `@copilotkit/react-core` |
| Tool call rendering | `@copilotkit/react-core/v2` |
| Components as tools | `@copilotkit/react-core/v2` |
| State rendering | `@copilotkit/react-core/v2` |
| Declarative (A2UI) | `@copilotkit/react-core/v2` |
| **Frontend tools** | `@copilotkit/react-core` |
| **Human-in-the-loop** | `@copilotkit/react-core` |

The page flags the switch once, for the Controlled tier — *"The Controlled
primitives use CopilotKit's v2 API, imported from `@copilotkit/react-core/v2`"* —
and never mentions the switch back.

Both imports are valid. Checked against the package's declarations in 1.70.1:

| Hook | v1 | v2 |
|---|---|---|
| `useFrontendTool` | ✅ | ✅ |
| `useHumanInTheLoop` | ✅ | ✅ |
| `useRenderTool` | ✅ | ✅ |
| `useAgent` | ✅ | ✅ |
| `useComponent` | — | ✅ only |

So nothing here is wrong. What is missing is whether they **compose**: CopilotKit
ships `.` and `./v2` as separate entrypoints with separate context modules, and
the page shows a `<CopilotKit>` from one entrypoint in one section and from the
other in the next. A reader building one app from both — which the page invites,
since these are features of one integration — has no guidance on whether a v1
provider serves a v2 hook.

**Ask:** say once, near the top, which entrypoint the guide is written against
and whether the two can be mixed in a single provider tree.

---

## 5 · `resourceId` is given two different meanings on one page

In the integration guide it reads as the agent selector:

```typescript
registerCopilotKit({
  path: '/copilotkit',
  resourceId: 'weatherAgent',
})
```

In the Configuration options table, three screens later, it is memory scoping:

| Option | Use it to |
|---|---|
| `resourceId` | Scope Mastra memory for conversations. |

And the same table says the agent is chosen elsewhere:

> By default, the endpoint exposes every agent registered on the Mastra
> instance, and the frontend chooses one with the `agent` prop.

So `resourceId: 'weatherAgent'` in the first snippet is a memory scope that
happens to be named after an agent — which reads, at the point a reader meets
it, exactly like the thing that selects the agent. Especially since the frontend
snippet immediately below passes `agent="weatherAgent"`, the same string.

**Ask:** use a value in the example that cannot be mistaken for an agent name
(`resourceId: 'user-session'`), or add a half-sentence saying it scopes memory
and does not select the agent.

---

## 6 · The unpublished tool's `execute` signature fails silently when guessed wrong

**A direct consequence of finding 2, found by running it.**

The page publishes `weatherAgent` with `import { weatherTool } from '../tools/weather-tool'`
and never publishes `weather-tool.ts`. So the reader writes it. In
`@mastra/core` **1.64.0** the signature is:

```ts
execute?: (inputData: TSchemaIn, context: TContext) => ...
```

— the validated input arrives as the **first** argument. Most Mastra material a
search turns up uses the older shape and destructures `{ context }` from that
first argument instead. Under 1.64 that yields `undefined`, and the tool throws.

What makes it worth reporting is how it surfaces. Nothing errors visibly: the
run completes, the chat streams a perfectly fluent reply, and the reply is

> "I'm unable to retrieve Lisbon's current weather because the weather service
> is temporarily failing."

The model narrates the tool failure as an outage. No console error, no failed
request, no card. A reader debugging this looks at Open-Meteo, at their network,
at their API key — everywhere except the two-character difference in a file the
page told them to write but not how.

Corrected to `execute: async ({ location }) => …`, the same agent returns real
data on the first try (`Reykjavík … clear skies … 12.8°C`).

**Ask:** publishing `weather-tool.ts` closes this and finding 2 together. It is
about fifteen lines.

---

## 7 · The progressive-rendering claim was not observed

**Observation, not a defect.** The Tool call rendering section says:

> Because Mastra streams tool-call arguments incrementally, the `render`
> function is called repeatedly as the arguments arrive, so the UI can paint
> progressively while the agent works.

The published render function returns `<div>Retrieving weather...</div>` while
`status !== 'complete'`. Across the recorded runs that intermediate state was
never seen: the card appeared already complete.

That is consistent with the claim being true and the window being shorter than
one frame — `{ location: "Reykjavik" }` is a very small argument object, so
there is almost nothing to stream. It is recorded here only so nobody reads the
clip as evidence the feature is broken. A tool with a larger argument payload
would be the way to demonstrate it, and would make a better example on the page.

---

## Sections not covered by a recording

Listed rather than silently absent, per the "removed/renamed pages" gap in
`project-context.md`:

| Section | Why | Implemented? |
|---|---|---|
| Chat UI options | `CopilotSidebar` / `CopilotPopup` take the same props as `CopilotChat`; a clip would show a panel elsewhere | no |
| Components as tools | `useComponent` — v2-only; small variation on tool rendering | no |
| State rendering | `useAgent` reading `agent.state` — needs a Mastra agent with working memory | no |
| Declarative (A2UI) | imports `./a2ui-catalog`, never published; writing one makes the clip about the catalog | no |
| Open-ended (MCP Apps) | needs an MCP server on `:3108` | no |
| Channels | needs `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN` and a Slack workspace | no |
| **Deployment** | a `mastra build` concern, not a recordable demo | **yes** — `mastra-server/src/mastra/index.ts` |

The Deployment claim is the page's most concrete testable statement — *"you must
exclude `@copilotkit/runtime` from the bundle ... will cause 500 errors if
included"* — and it is implemented. It cannot be exercised by `mastra dev`,
which the page also says.

## Recordings

| Section | Route | Recording |
|---|---|---|
| Integration guide | `/quickstart/demo-chat` | `MASTRA-ext-01-IntegrationGuide.webm` |
| Tool call rendering | `/tool-rendering/demo-chat` | `MASTRA-ext-02-ToolCallRendering.webm` |
| Frontend tools | `/frontend-tools/demo-chat` | `MASTRA-ext-03-FrontendTools.webm` |
| Human-in-the-loop | `/human-in-the-loop/demo-chat` | `MASTRA-ext-04-HumanInTheLoop.webm` |

## How to reproduce

Findings 1–5 are all readings of `doc-snapshot/pages/`, and need no key:

```bash
grep -c 'agents:' doc-snapshot/pages/*.md                     # finding 1: 0
grep -n "from '@/components/\|from '../tools/" doc-snapshot/pages/*.md  # finding 2
grep -n 'use client' doc-snapshot/pages/*.md                  # finding 3: no hits
grep -n "react-core/v2'\|react-core'" doc-snapshot/pages/*.md # finding 4
grep -n 'resourceId' doc-snapshot/pages/*.md                  # finding 5
```
