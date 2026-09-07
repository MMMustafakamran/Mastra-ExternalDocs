// ─────────────────────────────────────────────────────────────────────────────
// VERBATIM from https://mastra.ai/guides/build-your-ui/copilotkit/overview
// Snapshot: doc-snapshot/pages/guides__build-your-ui__copilotkit__overview.md
// Section: "Generative UI" -> "Controlled" -> "Tool call rendering"
//
// This is the **v2** surface: the section says so explicitly — "The Controlled
// primitives use CopilotKit's v2 API, imported from @copilotkit/react-core/v2."
// Note that `CopilotChat` on the next line still comes from the v1
// `@copilotkit/react-ui`, in the page's own snippet. Mixing the two entrypoints
// within one component is the page's choice, not this repo's; see FINDINGS.md
// finding 4.
//
// `<Weather {...result} />` spreads the tool's return value straight into the
// component, so the shape of `result` is a contract between this file and
// `weatherTool` — and the page publishes neither the tool nor the component.
// `@/components/weather` here is harness code written to match.
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

import { z } from 'zod'
import { CopilotChat } from '@copilotkit/react-ui'
import { CopilotKit, useRenderTool } from '@copilotkit/react-core/v2'
import { Weather } from '@/components/weather'

function Chat() {
  useRenderTool(
    {
      name: 'weatherTool',
      parameters: z.object({ location: z.string() }),
      render: ({ status, result }) => {
        if (status !== 'complete') {
          return <div>Retrieving weather...</div>
        }
        return <Weather {...result} />
      },
    },
    [],
  )

  return <CopilotChat labels={{ title: 'Weather Assistant' }} />
}

export default function Page() {
  return (
    <CopilotKit runtimeUrl="http://localhost:4111/copilotkit" agent="weatherAgent">
      <Chat />
    </CopilotKit>
  )
}
