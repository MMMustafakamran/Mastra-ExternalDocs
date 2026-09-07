import { type Page } from 'playwright';
import { humanGlide, sleep } from '../core/overlays/cursor';
import { type PageActionHandler, type PageRecordConfig } from '../core/types';
import { sendPrompt, waitForAgentResponseCompletion } from '../core/actions';

/**
 * `useRenderTool` painting a weather card from a streaming tool call.
 *
 * The page makes two claims here, and they need separate checks:
 *
 *   1. "the `render` function receives the tool call's `status` and, once the
 *      agent returns, its `result`" — so an intermediate "Retrieving
 *      weather..." should appear before the card.
 *   2. "Because Mastra streams tool-call arguments incrementally, the `render`
 *      function is called repeatedly as the arguments arrive, so the UI can
 *      paint progressively while the agent works."
 *
 * Claim 1 is what makes the feature visible; claim 2 is why it is interesting.
 * A run where the agent answers in prose and no card mounts looks like a
 * perfectly good clip, so both are checked rather than assumed.
 *
 * Warn rather than fail throughout: a model choosing not to call its tool is a
 * model problem, not a documentation defect, and the clip is still evidence.
 */

const LOADING_TEXT = 'Retrieving weather';
const CARD = '[data-testid="weather-card"]';

export const runToolRenderingAction: PageActionHandler = async (
  page: Page,
  config: PageRecordConfig,
  _rootPath,
  ctx,
) => {
  console.log(`   [ToolRendering] Prompting: "${config.prompt}"`);
  const msgCount = await sendPrompt(page, config.prompt, { timeoutMs: 12_000 });

  // Claim 1, the intermediate state. Short window on purpose — it is meant to
  // be transient, and a long wait here would just be waiting for the card.
  const sawLoading = await page
    .locator(`text=${LOADING_TEXT}`)
    .first()
    .isVisible({ timeout: 12_000 })
    .catch(() => false);

  if (sawLoading) {
    console.log('   ✅ [ToolRendering] Saw the pending state ("Retrieving weather...").');
  }

  const card = page.locator(CARD).first();
  const mounted = await card
    .waitFor({ state: 'visible', timeout: 25_000 })
    .then(() => true)
    .catch(() => false);

  if (mounted) {
    const box = await card.boundingBox();
    if (box) {
      console.log(`   🎯 Weather card at (${Math.round(box.x)}, ${Math.round(box.y)})`);
      await humanGlide(page, box.x + box.width / 2, box.y + box.height / 2, 22);
      await sleep(2600);
    }
  }

  await waitForAgentResponseCompletion(page, config.waitAfterPromptMs ?? 8000, msgCount);
  await sleep(1500);

  if (!mounted) {
    ctx.warn(
      '[ToolRendering] No weather card rendered. Either the agent answered in prose without ' +
        'calling weatherTool, or the `name` in useRenderTool does not match the tool id — the ' +
        'page names it "weatherTool" in both places, so a mismatch means one of them drifted.',
    );
    return;
  }

  if (!sawLoading) {
    ctx.warn(
      '[ToolRendering] The card mounted but the pending state ("Retrieving weather...") was never ' +
        'seen. The page says `render` is called repeatedly as arguments stream in; this run only ' +
        'painted the complete state, so the progressive rendering it describes did not happen ' +
        '(or happened faster than one frame).',
    );
    return;
  }

  // Did the card get real data, or did it mount with everything undefined?
  const text = await card.innerText().catch(() => '');
  if (text.includes('Unknown') || text.split('--').length > 3) {
    ctx.warn(
      '[ToolRendering] The card mounted but is mostly empty. `<Weather {...result} />` spreads the ' +
        'tool result straight in, so this means the field names the tool returns and the ones the ' +
        'component reads do not line up — the contract the page never states (finding 2).',
    );
    return;
  }

  console.log('   ✅ [ToolRendering] Card rendered with data — pending state then complete state.');
};
