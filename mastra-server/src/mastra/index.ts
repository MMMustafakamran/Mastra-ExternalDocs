// ─────────────────────────────────────────────────────────────────────────────
// Assembled from https://mastra.ai/guides/build-your-ui/copilotkit/overview
// Snapshot: doc-snapshot/pages/guides__build-your-ui__copilotkit__overview.md
//
// The page publishes this file in three separate places and never as a whole:
//
//   "Integration guide", step 2   the `server: { cors, apiRoutes }` block with
//                                 registerCopilotKit
//   "Open-ended"                  the same registerCopilotKit call plus `mcpApps`
//   "Deployment"                  `bundler: { externals: ['@copilotkit/runtime'] }`
//
// Each block is shown as `export const mastra = new Mastra({ ... })` with the
// rest elided as `// Rest of the configuration...`, so joining them is the
// reader's job. This is that join, with each block's origin marked.
//
// The one thing NOT in any block is the `agents` map — see the note at it.
// ─────────────────────────────────────────────────────────────────────────────

import { Mastra } from '@mastra/core/mastra'
import { registerCopilotKit } from '@ag-ui/mastra/copilotkit'

import { weatherAgent } from './agents/weather-agent'
import { planningAgent } from './agents/planning-agent'
import { bgColorAgent } from './agents/bg-color-agent'

export const mastra = new Mastra({
  // ── Not published on the page ────────────────────────────────────────────
  // The page's frontend snippets pass `agent="weatherAgent"` and say: "The
  // `agent` prop names the Mastra agent to route to. It must match a key in
  // your Mastra instance's `agents` map."
  //
  // That map is never shown. Every `new Mastra({...})` block on the page elides
  // it as `// Rest of the configuration...`, so a reader is told to match a key
  // in a structure the page does not display. See FINDINGS.md finding 1.
  //
  // The keys below are the three the page's own snippets name across its
  // sections: `weatherAgent`, `planningAgent` (Human-in-the-loop) and
  // `bgColorAgent` (Frontend tools).
  agents: { weatherAgent, planningAgent, bgColorAgent },

  // ── Deployment section ───────────────────────────────────────────────────
  // "you must exclude @copilotkit/runtime from the bundle. This package
  // contains dependencies that aren't compatible with bundling and will cause
  // 500 errors if included."
  //
  // Only bites on `mastra build`, not on `mastra dev` — so a harness that only
  // ever runs dev would never exercise it. Kept anyway: it is one of the page's
  // few unambiguous, testable claims.
  bundler: {
    externals: ['@copilotkit/runtime'],
  },

  // ── Integration guide, step 2 ────────────────────────────────────────────
  server: {
    cors: {
      origin: '*',
      allowMethods: ['*'],
      allowHeaders: ['*'],
    },
    apiRoutes: [
      registerCopilotKit({
        path: '/copilotkit',
        resourceId: 'weatherAgent',
      }),
    ],
  },
})
