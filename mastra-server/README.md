# mastra-server/ — provenance of each file

The Mastra side of <https://mastra.ai/guides/build-your-ui/copilotkit/overview>.

| File | Source | Note |
|---|---|---|
| `src/mastra/index.ts` | **Page**, three blocks joined | The page never shows the whole file — see its header |
| `src/mastra/agents/weather-agent.ts` | **Page**, verbatim | Under "Tool call rendering" |
| `src/mastra/tools/weather-tool.ts` | **Harness** | Imported by the published agent, never published — finding 2 |
| `src/mastra/agents/bg-color-agent.ts` | **Harness** | Described in one sentence, never published |
| `src/mastra/agents/planning-agent.ts` | **Harness** | Named by the frontend snippet, never published |

Three of five files are harness code, and that ratio is itself the report: this
page publishes its React surface in full and its Mastra surface in fragments.

## Dependencies

The page's step 2 install line, verbatim:

```
npm install @ag-ui/mastra @mastra/client-js @mastra/core @ag-ui/core @ag-ui/client @copilotkit/runtime
```

`package.json` here adds `zod` (the published `weatherTool` schema needs it),
`mastra` (the CLI that `npm run dev` invokes — the page assumes `create-mastra`
put it there) and `typescript`.

## Running

```bash
npm install
npm run dev        # http://localhost:4111, the page's own default
```

The AG-UI endpoint is then at `http://localhost:4111/copilotkit`, which is what
the frontend's `runtimeUrl` points at.
