// ─────────────────────────────────────────────────────────────────────────────
// VERBATIM from https://mastra.ai/guides/build-your-ui/copilotkit/overview
// Snapshot: doc-snapshot/pages/guides__build-your-ui__copilotkit__overview.md
// Section: "Generative UI" -> "Controlled" -> "Tool call rendering"
//
// Published on the page as:
//
//   import { Agent } from '@mastra/core/agent'
//   import { weatherTool } from '../tools/weather-tool'
//   export const weatherAgent = new Agent({ ... })
//
// `weatherTool` is imported but never published -- see ../tools/weather-tool.ts.
//
// Do not "fix" this file. A snippet that fails as published IS the finding.
// ─────────────────────────────────────────────────────────────────────────────

import { Agent } from '@mastra/core/agent'
import { weatherTool } from '../tools/weather-tool'

export const weatherAgent = new Agent({
  id: 'weather-agent',
  name: 'Weather Agent',
  instructions: 'Use the weatherTool to fetch current weather data.',
  model: 'openai/gpt-5.6-luna',
  tools: { weatherTool },
})
