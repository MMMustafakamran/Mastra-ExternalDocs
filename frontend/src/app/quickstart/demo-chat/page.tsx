// ─────────────────────────────────────────────────────────────────────────────
// VERBATIM from https://mastra.ai/guides/build-your-ui/copilotkit/overview
// Snapshot: doc-snapshot/pages/guides__build-your-ui__copilotkit__overview.md
// Section: "Integration guide", step 5 — published as `app/page.tsx`
//
// Two things about it worth noticing before you read it:
//
//  1. `runtimeUrl` is the absolute `http://localhost:4111/copilotkit` — this is
//     the standalone-server topology, where the Mastra server is its own
//     process and the Next app only renders. The page contrasts that with the
//     full-stack path in a note at the top.
//  2. The published file has no `"use client"`, and here that is FINE. Every
//     CopilotKit bundle ships the directive itself — `@copilotkit/react-core`,
//     its `/v2` entrypoint and `@copilotkit/react-ui` all begin with
//     `"use client";` — so importing them from a Server Component establishes
//     the client boundary on their side. This file renders nothing of its own
//     that calls a hook, so it works as published.
//
//     That is NOT true of the other three routes in this repo, which define a
//     local `Chat()` that calls a hook. See FINDINGS.md finding 3.
//
// The directive below is therefore consistency with those three, not a fix.
//
// Do not "fix" anything else here. A snippet that fails as published IS the
// finding.
// ─────────────────────────────────────────────────────────────────────────────

"use client"; // not required here — see the header

import { CopilotChat } from '@copilotkit/react-ui'
import { CopilotKit } from '@copilotkit/react-core'
import '@copilotkit/react-ui/styles.css'

export default function Home() {
  return (
    <CopilotKit runtimeUrl="http://localhost:4111/copilotkit" agent="weatherAgent">
      <CopilotChat
        labels={{
          title: 'Weather Agent',
          initial: 'Hi! 👋 Ask me about the weather, forecasts, and climate.',
        }}
      />
    </CopilotKit>
  )
}
