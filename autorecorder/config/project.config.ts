/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  ADAPT THIS FILE — 1 of 4
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Who this project is: which documentation it tests, where it lives, and how
 * its two services are reached and started.
 *
 * ── What is different about this copy ──────────────────────────────────────
 * This repo tests **Mastra's own** CopilotKit guide, not CopilotKit's Mastra
 * docs (that is the sibling `Mastra-react` repo).
 *
 * And Mastra documents the whole integration on **one page**. So `docBaseUrl`
 * is that page, and every entry in `pages.config.ts` sets `docPath` to an
 * anchor within it rather than to a separate URL. The recorder's step 1 opens
 * the same page for every clip and scrolls to a different section — which is
 * faithful to what a reader actually does.
 */

/** Sentinel for values an adaptation must supply. Doctor fails while any remain. */
export const REPLACE_ME = 'REPLACE_ME' as const;

export interface ProjectConfig {
  framework: string;
  frameworkLabel: string;
  videoPrefix: string;
  docBaseUrl: string;
  frontendUrl: string;
  backendUrl: string;
  backendHealthPath: string;
  frontendStartCmd: string;
  backendStartCmd: string;
  demoSuffix: string;
  timeouts?: Partial<import('../core/types').RecorderTimeouts>;
}

export const PROJECT: ProjectConfig = {
  framework: 'mastra-copilotkit',
  frameworkLabel: 'Mastra — CopilotKit guide (external docs)',

  // `-ext` separates these from the sibling `Mastra-react` repo, which tests
  // the same integration through CopilotKit's docs and writes `MASTRA-react-*`.
  videoPrefix: 'MASTRA-ext',

  // The single page. The assignment named /guides/build-your-ui/copilotkit/
  // overview, but since 2026-09-28 (at the latest) that URL is a 308 Permanent
  // Redirect to this one, so a clip opening it filmed a redirect.
  docBaseUrl: 'https://mastra.ai/integrations/agentic-ui/copilotkit',

  // 3303. Eleven sibling repos in this workspace default to 3000; the
  // external-docs repos take 3301 (ag2), 3302 (agno), 3303 (mastra).
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3303',

  // 4111 is the page's own: "By default, the Mastra server runs on
  // http://localhost:4111." The published frontend snippets hardcode
  // `runtimeUrl="http://localhost:4111/copilotkit"`, so moving it would mean
  // editing a doc snippet.
  backendUrl: process.env.MASTRA_URL || 'http://localhost:4111',

  // `mastra dev` serves a playground at the root and the AG-UI route at
  // `/copilotkit` (POST only, so not a probe). The root is the GET that proves
  // the process is up.
  backendHealthPath: '/',

  frontendStartCmd: 'cd frontend && npm run dev',
  backendStartCmd: 'cd mastra-server && npm run dev',

  demoSuffix: '/demo-chat',

  timeouts: {
    // `mastra dev` builds on first request and the agents call a live weather
    // API, so first replies are slower than a warm Next route.
    demoNavMs: 60_000,
  },
};

/** Absolute doc URL for a page's `docPath`. */
export function docUrlFor(docPath: string): string {
  const base = PROJECT.docBaseUrl.replace(/\/$/, '');
  const path = docPath.replace(/^\//, '');
  // Anchors, not paths: this is a one-page guide, so `docPath` is `#section`.
  if (!path) return base;
  return path.startsWith('#') ? `${base}${path}` : `${base}/${path}`;
}

/** Absolute demo URL for a page's `route`. */
export function demoUrlFor(route: string): string {
  return `${PROJECT.frontendUrl.replace(/\/$/, '')}/${route.replace(/^\//, '')}${PROJECT.demoSuffix}`;
}
