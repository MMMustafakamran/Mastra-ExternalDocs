// ─────────────────────────────────────────────────────────────────────────────
// HARNESS CODE -- NOT PUBLISHED BY THE DOCS.
//
// The "Frontend tools" section publishes the React side in full and describes
// the server side in one sentence:
//
//   "The matching Mastra agent is a normal agent instructed to call
//    colorChangeTool with the requested color."
//
// and its snippet points the provider at `agent="bgColorAgent"`. So the name is
// given, the behaviour is described, and no code is published. This is that
// sentence turned into the smallest agent that satisfies it.
//
// Note there is no `tools:` entry: `colorChangeTool` is a FRONTEND tool,
// registered in the browser with `useFrontendTool`, and reaches the agent
// through the AG-UI run input rather than through the Mastra agent definition.
// That is the part the one-sentence description leaves implicit.
// ─────────────────────────────────────────────────────────────────────────────

import { Agent } from '@mastra/core/agent'

export const bgColorAgent = new Agent({
  id: 'bg-color-agent',
  name: 'Background Color Agent',
  instructions:
    'When the user asks for a background colour, call colorChangeTool with the requested ' +
    'colour as a CSS colour string. Confirm the change in one short sentence.',
  model: 'openai/gpt-5.4-mini',
})
