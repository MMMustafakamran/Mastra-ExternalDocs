import { type Page } from 'playwright';
import { humanGlide, sleep } from '../core/overlays/cursor';
import { type PageActionHandler, type PageRecordConfig } from '../core/types';
import { sendPrompt, waitForAgentResponseCompletion } from '../core/actions';

/**
 * `useHumanInTheLoop` — the run suspends until `respond` is called.
 *
 * This is the one page where waiting for the reply to finish is the **wrong**
 * check. The page's whole claim is that the agent stops:
 *
 *   "Pause the agent mid-run and wait for the user to approve, edit, or reject
 *    before continuing. ... the agent's run stays suspended until you call it."
 *
 * A handler that waits for a completed reply would time out on a *working*
 * feature — because nothing completes until a human answers — and would pass on
 * a broken one that never paused at all. So the sequence here is: prompt, wait
 * for the approval card, interact with it, respond, and only then wait for the
 * run to finish.
 *
 * `ctx.fail` rather than `warn` when the card never appears: unlike a model
 * declining to call a tool, a run that does not suspend means the documented
 * feature did not happen.
 */

const CARD = '[data-testid="steps-feedback"]';
const ACCEPT = '[data-testid="steps-accept"]';

export const runHitlAction: PageActionHandler = async (
  page: Page,
  config: PageRecordConfig,
  _rootPath,
  ctx,
) => {
  console.log(`   [HITL] Prompting: "${config.prompt}"`);
  const msgCount = await sendPrompt(page, config.prompt, { timeoutMs: 12_000 });

  // The card is the evidence the run suspended. Generous window: the agent has
  // to plan the steps before it can ask about them.
  const card = page.locator(CARD).first();
  const appeared = await card
    .waitFor({ state: 'visible', timeout: 45_000 })
    .then(() => true)
    .catch(() => false);

  if (!appeared) {
    ctx.fail(
      '[HITL] The approval card never appeared. The run did not suspend, so `useHumanInTheLoop` ' +
        'never fired — either the agent did not call `generate_task_steps`, or the tool name on ' +
        'the frontend and the one the agent calls do not match.',
    );
    return;
  }

  console.log('   ✅ [HITL] Run suspended — the approval card is on screen.');
  const box = await card.boundingBox();
  if (box) {
    await humanGlide(page, box.x + box.width / 2, box.y + 60, 22);
  }
  // Read the steps like a person would before deciding.
  await sleep(3000);

  // Uncheck one, so the clip shows the "edit" the page promises rather than a
  // bare approval — "let the user toggle steps and then call respond".
  const boxes = page.locator(`${CARD} input[type="checkbox"]`);
  const count = await boxes.count().catch(() => 0);
  if (count > 1) {
    const second = boxes.nth(1);
    const cb = await second.boundingBox();
    if (cb) {
      await humanGlide(page, cb.x + cb.width / 2, cb.y + cb.height / 2, 18);
      await sleep(700);
    }
    await second.click().catch(() => {});
    console.log(`   [HITL] Deselected step 2 of ${count}.`);
    await sleep(1600);
  }

  const accept = page.locator(ACCEPT).first();
  const ab = await accept.boundingBox().catch(() => null);
  if (ab) {
    await humanGlide(page, ab.x + ab.width / 2, ab.y + ab.height / 2, 20);
    await sleep(900);
  }
  await accept.click().catch(() => {});
  console.log('   [HITL] Called respond({ accepted: true, steps }).');

  // Only now does waiting for completion mean anything.
  await waitForAgentResponseCompletion(page, config.waitAfterPromptMs ?? 8000, msgCount);
  await sleep(2000);

  const stillWaiting = await page
    .locator(ACCEPT)
    .first()
    .isVisible({ timeout: 2000 })
    .catch(() => false);

  if (stillWaiting) {
    ctx.warn(
      '[HITL] The approval controls are still on screen after responding. `respond` did not ' +
        'resume the run — the agent stayed suspended.',
    );
  } else {
    console.log('   ✅ [HITL] Run resumed after respond().');
  }
};
