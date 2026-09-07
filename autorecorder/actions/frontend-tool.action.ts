import { type Page } from 'playwright';
import { sleep } from '../core/overlays/cursor';
import { type PageActionHandler, type PageRecordConfig } from '../core/types';
import { sendPrompt, waitForAgentResponseCompletion } from '../core/actions';

/**
 * `useFrontendTool` — the agent acting on the page.
 *
 * The published handler is one line:
 *
 *   handler: ({ color }) => { document.body.style.setProperty('--background', color) }
 *
 * which makes this the hardest kind of feature to verify from a recording: the
 * whole effect is a CSS custom property, and the agent will happily say "Done,
 * I've changed the background to navy" whether or not the handler ever ran. A
 * standard action would pass on a completely broken integration.
 *
 * So this reads `--background` off `document.body` before and after, and
 * reports the pair.
 */

async function readBackgroundVar(page: Page): Promise<string> {
  return page
    .evaluate(() => document.body.style.getPropertyValue('--background').trim())
    .catch(() => '');
}

export const runFrontendToolAction: PageActionHandler = async (
  page: Page,
  config: PageRecordConfig,
  _rootPath,
  ctx,
) => {
  const before = await readBackgroundVar(page);
  console.log(`   [FrontendTool] --background before: "${before || '(unset)'}"`);

  const msgCount = await sendPrompt(page, config.prompt, { timeoutMs: 12_000 });
  await waitForAgentResponseCompletion(page, config.waitAfterPromptMs ?? 6000, msgCount);

  // The handler runs when the tool call arrives, which can be slightly after
  // the text finishes streaming.
  await sleep(2500);
  const after = await readBackgroundVar(page);
  console.log(`   [FrontendTool] --background after:  "${after || '(unset)'}"`);

  // Hold on the changed page for a beat — the point of the clip is the colour.
  await sleep(2500);

  if (after && after !== before) {
    console.log(`   ✅ [FrontendTool] handler ran in the browser — --background is now "${after}".`);
    return;
  }

  const reply = await page
    .locator('.copilotKitAssistantMessage')
    .last()
    .innerText()
    .catch(() => '');

  if (/chang|set|updat|done/i.test(reply)) {
    ctx.warn(
      `[FrontendTool] The agent says it changed the background ("${reply.slice(0, 80)}…") but ` +
        `\`--background\` on document.body is still "${after || '(unset)'}". The tool call did not ` +
        `reach the browser handler — which is exactly the failure a text-only check would miss.`,
    );
  } else {
    ctx.warn(
      '[FrontendTool] `--background` never changed and the reply does not claim it did. The agent ' +
        'probably never called `colorChangeTool` — note the page publishes no Mastra agent for ' +
        'this section, only a sentence describing one (finding 2).',
    );
  }
};
