// ─────────────────────────────────────────────────────────────────────────────
// HARNESS CODE -- NOT PUBLISHED BY THE DOCS.
//
// The "Human-in-the-loop" section publishes the React side in full, points the
// provider at `agent="planningAgent"`, and says the agent calls
// `generate_task_steps`. It publishes no agent.
//
// `generate_task_steps` is a client tool: the frontend fulfils it through the
// `respond` callback, and the agent's run stays suspended until it does. So,
// as with bgColorAgent, there is no `tools:` entry here -- the tool arrives on
// the AG-UI run input from the browser.
// ─────────────────────────────────────────────────────────────────────────────

import { Agent } from '@mastra/core/agent'

export const planningAgent = new Agent({
  id: 'planning-agent',
  name: 'Planning Agent',
  instructions:
    'When the user asks for a plan, call generate_task_steps with a list of steps. ' +
    'Each step needs a description and a status of "enabled". After the user responds, ' +
    'acknowledge which steps they kept and continue.',
  model: 'openai/gpt-5.6-sol',
})
