/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  ADAPT THIS FILE — 3 of 4
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * One entry per doc **section**, in the order the page presents them.
 *
 * Mastra documents this whole integration on one page, so `docPath` here is an
 * anchor (`#frontend-tools`) rather than a path. `project.config.ts`'s
 * `docUrlFor` appends it to the page URL, and the recorder's step 1 opens the
 * same page for every clip and scrolls to a different part of it — which is
 * exactly what a reader working through the guide does.
 *
 * ── Sections with no entry, and why ────────────────────────────────────────
 *   Chat UI options       swapping CopilotChat for CopilotSidebar/CopilotPopup.
 *                         Same props, same provider; a clip would show a panel
 *                         in a different place and prove nothing new.
 *   Declarative (A2UI)    needs a component catalog the page never publishes
 *                         (`./a2ui-catalog` is imported, not shown). Writing
 *                         one would make the clip about the catalog.
 *   Open-ended (MCP Apps) needs an MCP server on :3108. Out of scope here.
 *   Channels              needs SLACK_BOT_TOKEN, SLACK_APP_TOKEN and a Slack
 *                         workspace to install into.
 *   Deployment            `mastra build` with `bundler.externals`. A build
 *                         check, not a recordable demo — it IS implemented, in
 *                         mastra-server/src/mastra/index.ts.
 *
 * These are listed in the README's status table rather than left silently
 * absent, per the "removed/renamed pages" gap in project-context.md.
 */

import { definePages, type PageDefinition } from '../core/types';

const PAGE_DEFS: PageDefinition[] = [
  {
    id: 'quickstart',
    name: 'Integration guide — standalone Mastra server + CopilotKit frontend',
    videoName: 'IntegrationGuide',
    docPath: '#integration-guide',
    route: 'quickstart',

    // The runtime registration first — `registerCopilotKit` is the whole
    // server-side integration — then the page's own frontend.
    ideFile: 'mastra-server/src/mastra/index.ts',
    startLine: 19,
    endLine: 67,
    extraTabs: [
      { filePath: 'frontend/src/app/quickstart/demo-chat/page.tsx', startLine: 28, endLine: 45 },
    ],

    prompt: 'What is the weather in Lisbon right now?',
    waitAfterPromptMs: 15_000,
  },
  {
    id: 'tool-rendering',
    name: 'Generative UI · Controlled — useRenderTool paints the tool call',
    videoName: 'ToolCallRendering',
    docPath: '#controlled',
    route: 'tool-rendering',

    // The v2 hook, then the two files the page imports and never publishes:
    // the tool whose result it spreads, and the agent that owns the tool.
    ideFile: 'frontend/src/app/tool-rendering/demo-chat/page.tsx',
    startLine: 28,
    endLine: 59,
    extraTabs: [
      { filePath: 'mastra-server/src/mastra/agents/weather-agent.ts', startLine: 17, endLine: 26 },
      { filePath: 'mastra-server/src/mastra/tools/weather-tool.ts', startLine: 47, endLine: 70 },
    ],

    prompt: 'What is the weather in Reykjavik?',
    waitAfterPromptMs: 18_000,
  },
  {
    id: 'frontend-tools',
    name: 'App control — useFrontendTool changes the page from the agent',
    videoName: 'FrontendTools',
    docPath: '#frontend-tools',
    route: 'frontend-tools',

    ideFile: 'frontend/src/app/frontend-tools/demo-chat/page.tsx',
    startLine: 27,
    endLine: 53,
    extraTabs: [
      // The agent the page describes in one sentence and never publishes.
      { filePath: 'mastra-server/src/mastra/agents/bg-color-agent.ts', startLine: 20, endLine: 29 },
    ],

    prompt: 'Change the background to a deep navy blue.',
    waitAfterPromptMs: 14_000,
  },
  {
    id: 'human-in-the-loop',
    name: 'App control — useHumanInTheLoop suspends the run until respond()',
    videoName: 'HumanInTheLoop',
    docPath: '#human-in-the-loop',
    route: 'human-in-the-loop',

    ideFile: 'frontend/src/app/human-in-the-loop/demo-chat/page.tsx',
    startLine: 30,
    endLine: 66,
    extraTabs: [
      // The component the page specifies in a paragraph and never publishes.
      { filePath: 'frontend/src/components/steps-feedback.tsx', startLine: 20, endLine: 60 },
    ],

    prompt: 'Plan a three-step launch checklist for a new landing page.',
    waitAfterPromptMs: 20_000,
  },
];

export const PAGES = definePages(PAGE_DEFS);

/** Pages kept registered (doctor, CI groups) but never recorded. id -> reason. */
export const SKIP_RECORDING: Record<string, string> = {};
