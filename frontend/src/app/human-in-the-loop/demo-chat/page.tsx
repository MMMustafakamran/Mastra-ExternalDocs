// ─────────────────────────────────────────────────────────────────────────────
// VERBATIM from https://mastra.ai/guides/build-your-ui/copilotkit/overview
// Snapshot: doc-snapshot/pages/guides__build-your-ui__copilotkit__overview.md
// Section: "App control and interactivity" -> "Human-in-the-loop"
//
// `@/components/steps-feedback` is imported by the published snippet and is not
// published anywhere. The page says what it must do:
//
//   "Inside StepsFeedback, let the user toggle steps and then call
//    respond({ accepted: true, steps }) to resume the agent, or
//    respond({ accepted: false }) to reject."
//
// and points at the UI Dojo for "the full component". So the component here is
// harness code written from that paragraph — see FINDINGS.md finding 2 for why
// that pattern recurs on this page.
//
// Like Frontend tools above, `useHumanInTheLoop` is imported from the v1 path
// while the generative-UI section uses v2.
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
import { CopilotKit, useHumanInTheLoop } from '@copilotkit/react-core'
import { StepsFeedback } from '@/components/steps-feedback'

function Chat() {
  useHumanInTheLoop({
    name: 'generate_task_steps',
    description: 'Generates a list of steps for the user to perform',
    parameters: [
      {
        name: 'steps',
        type: 'object[]',
        attributes: [
          { name: 'description', type: 'string' },
          { name: 'status', type: 'string', enum: ['enabled', 'disabled', 'executing'] },
        ],
      },
    ],
    available: 'enabled',
    // `respond` resumes the agent with the user's edited selection.
    render: ({ args, respond, status }) => (
      <StepsFeedback args={args} respond={respond} status={status} />
    ),
  })

  return <CopilotChat labels={{ title: 'Planning Agent' }} />
}

export default function Page() {
  return (
    <CopilotKit runtimeUrl="http://localhost:4111/copilotkit" agent="planningAgent">
      <Chat />
    </CopilotKit>
  )
}
