// ─────────────────────────────────────────────────────────────────────────────
// VERBATIM from https://mastra.ai/guides/build-your-ui/copilotkit/overview
// Snapshot: doc-snapshot/pages/guides__build-your-ui__copilotkit__overview.md
// Section: "App control and interactivity" -> "Frontend tools"
//
// Note the import: `useFrontendTool` comes from `@copilotkit/react-core` — the
// **v1** path — while the Tool call rendering section three headings earlier
// imports from `@copilotkit/react-core/v2` and says so in prose. Both hooks
// exist at both entrypoints in 1.70.1 (checked against the package's own type
// declarations), so neither import is wrong; the page just never says whether
// they compose in one app. FINDINGS.md finding 4.
//
// The matching Mastra agent is described on the page in one sentence and never
// published — `mastra-server/src/mastra/agents/bg-color-agent.ts` is that
// sentence turned into code.
//
// ── One line added ─────────────────────────────────────────────────────────
// The published snippet has no `"use client"`, and this file needs one: it
// defines a local `Chat()` component that calls a hook. CopilotKit's own
// bundles carry the directive, so *importing* them from a Server Component is
// fine — but a component the reader writes in their own file is not covered by
// that, and calling a hook from a Server Component throws. The page presents
// these as `app/page.tsx` in a Next App Router project and never mentions it.
// FINDINGS.md finding 3.
// ─────────────────────────────────────────────────────────────────────────────

"use client"; // ← added; required here, see the header

import { CopilotChat } from '@copilotkit/react-ui'
import { CopilotKit, useFrontendTool } from '@copilotkit/react-core'

function Chat() {
  useFrontendTool({
    name: 'colorChangeTool',
    description: 'Changes the background color',
    parameters: [
      { name: 'color', type: 'string', description: 'The color to change to', required: true },
    ],
    handler: ({ color }) => {
      document.body.style.setProperty('--background', color)
    },
  })

  return <CopilotChat labels={{ title: 'Background Color Changer' }} />
}

export default function Page() {
  return (
    <CopilotKit runtimeUrl="http://localhost:4111/copilotkit" agent="bgColorAgent">
      <Chat />
    </CopilotKit>
  )
}
