/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  ADAPT THIS DIRECTORY
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * What the recorder *does* on each demo page once it is open.
 *
 * A page with no entry falls back to `runStandardAction` — type the prompt,
 * submit, wait for the reply. Write a handler only where "the agent replied" is
 * not the same thing as "the feature worked", which on this page is three of
 * the four sections:
 *
 *   tool-rendering     the agent can describe the weather in prose without the
 *                      renderer ever mounting; the chat looks identical
 *   frontend-tools     the whole feature is a side effect on `document.body`,
 *                      which no reply text reveals
 *   human-in-the-loop  the run is supposed to SUSPEND. A handler that just
 *                      waits for a reply would time out on a working feature
 *                      and pass on a broken one that never paused
 *
 * The sixteen handlers this folder shipped with were written against
 * CopilotKit's own doc pages, none of which exist here. Deleted rather than
 * left orphaned: the doctor's orphan warning is only useful when it is quiet
 * by default.
 *
 * `ctx` is how a handler reports what it saw:
 *
 *   ctx.warn('Weather card never mounted')  -> [PASS*] with the note
 *   ctx.fail('Approval card never appeared') -> [FAIL], clip still saved
 *
 * A `console.log` reaches nobody.
 */

import { type ActionContext, type PageActionHandler, type PageRecordConfig } from '../core/types';
import { runStandardAction } from '../core/actions';
import { type Page } from 'playwright';

import { runToolRenderingAction } from './tool-rendering.action';
import { runFrontendToolAction } from './frontend-tool.action';
import { runHitlAction } from './hitl.action';

/** Keys are page ids from `config/pages.config.ts`. Doctor flags any orphans. */
export const ACTION_MAP: Record<string, PageActionHandler> = {
  'tool-rendering': runToolRenderingAction,
  'frontend-tools': runFrontendToolAction,
  'human-in-the-loop': runHitlAction,
};

export async function executePageAction(
  page: Page,
  config: PageRecordConfig,
  rootPath: string,
  ctx: ActionContext,
): Promise<void> {
  const handler = ACTION_MAP[config.id] ?? runStandardAction;
  await handler(page, config, rootPath, ctx);
}
