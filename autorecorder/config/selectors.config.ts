/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  ADAPT THIS FILE — 2 of 4
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The DOM contract: how the recorder finds the chat surface it has to drive.
 *
 * This frontend renders `CopilotChat` from `@copilotkit/react-ui` — the **v1**
 * surface. v1 ships
 * stable `copilotKit*` class names, so these can be tighter than the v2 repos'
 * equivalents, which have to lean on `data-testid` hooks instead.
 *
 * `npm run doctor:online` checks each of these against a live demo page and
 * reports which ones match nothing.
 */

export interface SelectorContract {
  /** The prompt box. First match wins, so order matters. */
  chatInput: string;

  /** Send control. When it matches nothing the recorder presses Enter. */
  chatSubmit: string;

  /**
   * Assistant messages, used to detect that a reply started and finished.
   * Must match *only* messages — matching a container makes every reply look
   * complete the instant it starts, and the videos then show prompts with no
   * answers.
   */
  assistantMessage: string;

  /** Any of these appearing means the demo has rendered enough to drive. */
  chatReady: string;

  /** Doc page has painted enough to start reading. */
  docContentReady: string;

  /** Code blocks on the doc page, so the cursor can rest on one. */
  docCodeBlock: string;
}

export const SELECTORS: SelectorContract = {
  chatInput:
    '.copilotKitInput textarea, [data-testid="copilot-chat-textarea"], textarea, input[type="text"]',

  chatSubmit:
    '.copilotKitSendButton, [data-testid="copilot-send-button"], button[type="submit"], button[aria-label*="Send" i]',

  // `.copilotKitAssistantMessage` is v1's own class and matches one bubble per
  // reply, which is exactly what the start/finish detection needs. The
  // `:not(:first-child)` fallback keeps the `initial` welcome message from
  // being counted as an answer to the first prompt.
  assistantMessage:
    '.copilotKitAssistantMessage, [data-message-role="assistant"], .copilotKitMessage:not(:first-child)',

  chatReady: '.copilotKitChat, .copilotKitInput, textarea, [class*="copilotKit"]',

  // mastra.ai docs render the body into `main article`. `h1` alone paints
  // before the code blocks exist, which is early enough that the reading-pace
  // scroll starts against a half-built page.
  docContentReady: 'main article, article, main, h1',

  // The page's install blocks are npm/pnpm/yarn/bun tabs that hide all but one
  // at a time -- `pre` is the one thing present in every tab state.
  docCodeBlock: 'pre, code',
};
