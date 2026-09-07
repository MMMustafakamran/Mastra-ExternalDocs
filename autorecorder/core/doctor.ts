import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ACTION_MAP } from '../actions';
import { CLI_FLOWS, CLI_VIDEOS } from '../config/cli.config';
import { PAGES } from '../config/pages.config';
import { PROJECT, REPLACE_ME } from '../config/project.config';
import { SELECTORS } from '../config/selectors.config';
import { hasFfmpeg } from './cli/audio';
import { type IdeTabConfig } from './ide/generator';

/**
 * The adaptation contract, as something that runs.
 *
 * This exists because prose instructions drift and a plausible-looking config
 * is not a working one. Everything an adaptation can plausibly get wrong is
 * checked here, so "is this port finished?" has one answer: whether this exits
 * zero. A guide can be skimmed; a red check cannot.
 *
 * Static by default so it works with nothing running. `--online` additionally
 * probes the doc and demo URLs and the selector contract against a real page,
 * which is the half that catches a config that is internally consistent but
 * points at the wrong app.
 */

interface Problem {
  scope: string;
  severity: 'error' | 'warning';
  message: string;
}

const MARKER = /\[!code highlight\]|#region\b/;

function checkTab(
  rootDir: string,
  scope: string,
  tab: IdeTabConfig,
  label: string,
  problems: Problem[],
): void {
  const fullPath = join(rootDir, tab.filePath);

  if (!existsSync(fullPath)) {
    problems.push({
      scope,
      severity: 'error',
      message: `${label}: ${tab.filePath} does not exist`,
    });
    return;
  }

  const lines = readFileSync(fullPath, 'utf-8').replace(/\r\n/g, '\n').split('\n');

  if (tab.startLine < 1 || tab.startLine > tab.endLine) {
    problems.push({
      scope,
      severity: 'error',
      message: `${label}: invalid range ${tab.startLine}-${tab.endLine}`,
    });
    return;
  }

  if (tab.endLine > lines.length) {
    problems.push({
      scope,
      severity: 'error',
      message: `${label}: range ${tab.startLine}-${tab.endLine} runs past end of ${tab.filePath} (${lines.length} lines)`,
    });
    return;
  }

  if (!lines.some((l) => MARKER.test(l))) return;

  const covers = lines
    .slice(tab.startLine - 1, tab.endLine)
    .some((l) => MARKER.test(l));

  if (!covers) {
    const at = lines
      .map((l, i) => (MARKER.test(l) ? i + 1 : 0))
      .filter(Boolean)
      .join(', ');
    problems.push({
      scope,
      severity: 'warning',
      message: `${label}: range ${tab.startLine}-${tab.endLine} covers no marked line (markers at ${at}) -- likely drifted`,
    });
  }
}

/** Fields that must be filled in for the adaptation to mean anything. */
function checkProject(problems: Problem[]): void {
  const required: (keyof typeof PROJECT)[] = [
    'framework',
    'frameworkLabel',
    'videoPrefix',
    'docBaseUrl',
    'frontendUrl',
    'backendUrl',
    'frontendStartCmd',
    'backendStartCmd',
  ];

  for (const key of required) {
    const value = String(PROJECT[key] ?? '');
    if (!value || value.includes(REPLACE_ME)) {
      problems.push({
        scope: 'project.config',
        severity: 'error',
        message: `${key} is still ${value ? REPLACE_ME : 'empty'} -- adaptation incomplete`,
      });
    }
  }

  if (!PROJECT.docBaseUrl.includes(PROJECT.framework)) {
    problems.push({
      scope: 'project.config',
      severity: 'warning',
      message: `docBaseUrl does not contain framework slug "${PROJECT.framework}" -- one of them is wrong`,
    });
  }

  for (const [key, url] of [
    ['docBaseUrl', PROJECT.docBaseUrl],
    ['frontendUrl', PROJECT.frontendUrl],
    ['backendUrl', PROJECT.backendUrl],
  ] as const) {
    try {
      new URL(url);
    } catch {
      problems.push({
        scope: 'project.config',
        severity: 'error',
        message: `${key} is not a valid URL: ${url}`,
      });
    }
  }
}

function checkSelectors(problems: Problem[]): void {
  for (const [key, value] of Object.entries(SELECTORS)) {
    if (!value || value.includes(REPLACE_ME)) {
      problems.push({
        scope: 'selectors.config',
        severity: 'error',
        message: `${key} is empty or still ${REPLACE_ME}`,
      });
    }
  }
}

function checkPages(rootDir: string, problems: Problem[]): void {
  if (PAGES.length === 0) {
    problems.push({
      scope: 'pages.config',
      severity: 'error',
      message: 'no pages registered',
    });
    return;
  }

  const ids = new Set<string>();
  const filenames = new Set<string>();

  for (const page of PAGES) {
    const scope = page.id;

    if (ids.has(page.id)) {
      problems.push({ scope, severity: 'error', message: 'duplicate page id' });
    }
    ids.add(page.id);

    if (filenames.has(page.filename)) {
      problems.push({
        scope,
        severity: 'error',
        message: `duplicate output filename "${page.filename}" -- one recording would overwrite the other`,
      });
    }
    filenames.add(page.filename);

    if (!page.docUrl.startsWith(PROJECT.docBaseUrl)) {
      problems.push({
        scope,
        severity: 'error',
        message: 'docUrl escaped docBaseUrl -- points at another framework',
      });
    }

    if (!page.prompt || page.prompt.includes(REPLACE_ME)) {
      problems.push({ scope, severity: 'error', message: 'prompt is empty or a placeholder' });
    }

    if (page.prompts?.length && page.prompts[0] !== page.prompt) {
      problems.push({
        scope,
        severity: 'warning',
        message: 'prompts[0] differs from prompt -- one of them is stale',
      });
    }

    // A generated page's files are produced by the CLI pipeline, so before that
    // has run they are legitimately absent. Report the state rather than failing
    // the whole adaptation over work that has not happened yet — but check them
    // normally the moment they do exist, because then a bad range is a real bug.
    const tabs = [
      {
        tab: { filePath: page.ideFile, startLine: page.startLine, endLine: page.endLine },
        label: 'ideFile',
      },
      ...(page.extraTabs ?? []).map((tab, i) => ({ tab, label: `extraTabs[${i}]` })),
    ];

    for (const { tab, label } of tabs) {
      if (page.generated && !existsSync(join(rootDir, tab.filePath))) {
        problems.push({
          scope,
          severity: 'warning',
          message: `${label} ${tab.filePath} not present yet — run the CLI pipeline (capture --scaffold, --distribute) before recording this page`,
        });
        continue;
      }
      checkTab(rootDir, scope, tab, label, problems);
    }

    // The demo route has to exist in this repo's frontend. A page listed here
    // with no route behind it is the "pages with no /demo route" gap from
    // project-context.md, and it only surfaced before as an HTTP 404 at record
    // time. Checked statically where the frontend is a Next.js App Router
    // tree; other frontends skip it (and --online still probes the URL).
    if (!page.devServer) {
      const appDir = join(rootDir, 'frontend', 'src', 'app');
      if (existsSync(appDir)) {
        const routeDir = join(appDir, ...page.route.split('/'), ...PROJECT.demoSuffix.split('/').filter(Boolean));
        const hasPage = ['page.tsx', 'page.ts', 'page.jsx', 'page.js', 'route.ts'].some((f) =>
          existsSync(join(routeDir, f)),
        );
        if (!hasPage) {
          problems.push({
            scope,
            severity: 'error',
            message: `demo route /${page.route}${PROJECT.demoSuffix} has no page under frontend/src/app — the recording would 404`,
          });
        }
      }
    }
  }

  // Handlers registered for pages that no longer exist.
  for (const id of Object.keys(ACTION_MAP)) {
    if (!ids.has(id)) {
      problems.push({
        scope: 'actions/index',
        severity: 'warning',
        message: `handler registered for unknown page id "${id}"`,
      });
    }
  }
}

/** Live probes: the half that catches a config pointing at the wrong app. */
/**
 * The CLI flow registry.
 *
 * The failure this is really guarding against: a flow that answers prompts by
 * counting keypresses instead of naming the row it wants. That version works on
 * the day it is written and silently scaffolds the wrong framework the day the
 * menu gains an entry — a passing run that produced the wrong project. Nothing
 * downstream can detect it, so it has to be caught here.
 */
function checkCliFlows(problems: Problem[]): void {
  for (const flow of CLI_FLOWS) {
    const scope = `cli:${flow.id}`;

    if (!flow.command || flow.command.includes(REPLACE_ME)) {
      problems.push({ scope, severity: 'error', message: 'command is empty or a placeholder' });
    }

    // Only flows that answer prompts are expected to produce something. A flow
    // with no steps is a bare command (a sign-in, say) whose output may be
    // somewhere this config has no business asserting about.
    if (flow.steps?.length && !flow.expectFiles?.length) {
      problems.push({
        scope,
        severity: 'warning',
        message:
          'no expectFiles — a command that answers every prompt and writes nothing would still pass',
      });
    }

    for (const [i, step] of (flow.steps ?? []).entries()) {
      const stepScope = `${scope} step ${i + 1} (${step.label})`;

      if (!step.waitFor) {
        problems.push({
          scope: stepScope,
          severity: 'warning',
          message:
            'no waitFor — the step acts as soon as the previous one finishes, which is a race with the prompt painting',
        });
      }

      if (!step.select && !step.keys?.length && step.type == null) {
        problems.push({
          scope: stepScope,
          severity: 'error',
          message: 'does nothing: no select, no keys, no text to type',
        });
      }

      // Down/Up repeated by hand is the counting antipattern in disguise.
      const arrowRun = (step.keys ?? []).filter((k) => k === 'Down' || k === 'Up').length;
      if (!step.select && arrowRun > 1) {
        problems.push({
          scope: stepScope,
          severity: 'error',
          message: `sends ${arrowRun} arrow keys without a select — name the row with select: { label } instead of counting keypresses`,
        });
      }
    }

    if (flow.steps?.length && !flow.steps.some((s) => s.waitFor)) {
      problems.push({
        scope,
        severity: 'error',
        message: 'no step waits for anything — the whole flow is a race',
      });
    }
  }
}

/**
 * The CLI video registry.
 *
 * A video that names a flow which does not exist used to be found by
 * `cli-render.ts` throwing halfway through a render; a missing narration
 * file was found by ffmpeg. Both are configuration, and belong here.
 */
function checkCliVideos(rootDir: string, problems: Problem[]): void {
  const flowIds = new Set(CLI_FLOWS.map((f) => f.id));
  const videoIds = new Set<string>();
  const files = new Set<string>();
  let anyAudio = false;

  const pageIds = new Set(PAGES.map((p) => p.id));

  for (const video of CLI_VIDEOS) {
    const scope = `cli-video:${video.id}`;

    for (const id of [video.id, video.onFailure?.id].filter((x): x is string => Boolean(x))) {
      if (videoIds.has(id)) {
        problems.push({ scope, severity: 'error', message: `duplicate video id "${id}"` });
      }
      videoIds.add(id);
    }

    for (const file of [video.videoFile, video.failureVideoFile].filter((x): x is string => Boolean(x))) {
      if (files.has(file)) {
        problems.push({
          scope,
          severity: 'error',
          message: `duplicate output filename "${file}" -- one render would overwrite the other`,
        });
      }
      files.add(file);
    }

    if (video.onSuccess && !pageIds.has(video.onSuccess.recordPage)) {
      problems.push({
        scope,
        severity: 'error',
        message: `onSuccess.recordPage "${video.onSuccess.recordPage}" is not a page in pages.config.ts`,
      });
    }

    if (video.onFailure) {
      for (const [i, tab] of (video.onFailure.ideTabs ?? []).entries()) {
        // Generated files; absent until the pipeline has run, and possibly
        // absent after a failed install too. The render skips missing ones.
        if (existsSync(join(rootDir, tab.filePath))) {
          checkTab(rootDir, `${scope} onFailure`, tab, `ideTabs[${i}]`, problems);
        }
      }
      if (video.onFailure.audio) {
        anyAudio = true;
        if (!existsSync(join(rootDir, 'autorecorder', video.onFailure.audio))) {
          problems.push({ scope, severity: 'error', message: `onFailure audio file ${video.onFailure.audio} does not exist` });
        }
      }
    }

    for (const id of video.flows) {
      if (!flowIds.has(id)) {
        problems.push({ scope, severity: 'error', message: `references flow "${id}", which is not registered` });
      }
    }
    if (video.flows.length === 0) {
      problems.push({ scope, severity: 'error', message: 'has no flows — nothing to film' });
    }

    for (const [i, tab] of (video.ideTabs ?? []).entries()) {
      // Finding clips show generated files, which may not exist before the
      // pipeline has run; that is a warning, as it is for generated pages.
      if (!existsSync(join(rootDir, tab.filePath))) {
        problems.push({
          scope,
          severity: 'warning',
          message: `ideTabs[${i}] ${tab.filePath} not present — run the CLI pipeline before rendering this video`,
        });
      } else {
        checkTab(rootDir, scope, tab, `ideTabs[${i}]`, problems);
      }
    }

    if (video.audio) {
      anyAudio = true;
      if (!existsSync(join(rootDir, 'autorecorder', video.audio))) {
        problems.push({ scope, severity: 'error', message: `audio file ${video.audio} does not exist` });
      }
    }
  }

  if (anyAudio && !hasFfmpeg()) {
    problems.push({
      scope: 'cli-video',
      severity: 'warning',
      message: 'a video declares narration but ffmpeg is not on PATH — the render will succeed without sound',
    });
  }
}

async function checkOnline(problems: Problem[]): Promise<void> {
  const get = async (url: string): Promise<number | string> => {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      return res.status;
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  };

  for (const page of PAGES) {
    const status = await get(page.demoUrl);
    if (status !== 200) {
      problems.push({
        scope: page.id,
        severity: 'error',
        message: `demo route ${page.demoUrl} -> ${status}`,
      });
    }
  }

  for (const page of PAGES) {
    const status = await get(page.docUrl);
    if (typeof status === 'number' && status >= 400) {
      problems.push({
        scope: page.id,
        severity: 'warning',
        message: `doc page ${page.docUrl} -> ${status} (page may not exist for this framework)`,
      });
    }
  }

  // Selector contract, against the first demo page that loads.
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  try {
    const p = await browser.newPage();
    await p.goto(PAGES[0].demoUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await p.waitForTimeout(3000);

    // chatInput and chatReady are load-bearing: without them there is nothing to
    // drive. chatSubmit is optional by design -- the recorder presses Enter when
    // it finds no submit control, which is what actually happens on CopilotKit
    // v2, whose send button carries no type, aria-label or text. Reporting that
    // as an error would put the reference implementation permanently in the red
    // and teach everyone to ignore this command.
    //
    // Each selector is a comma list of alternatives, first match wins. Saying
    // *which* alternative matched is the difference between "chatReady is
    // fine" and "chatReady is matching a bare <input> that is not the chat".
    for (const key of ['chatInput', 'chatReady', 'assistantMessage'] as const) {
      const alternatives = SELECTORS[key].split(',').map((s) => s.trim()).filter(Boolean);
      const hits: string[] = [];
      for (const alt of alternatives) {
        const n = await p.locator(alt).count().catch(() => 0);
        if (n > 0) hits.push(`${alt} (${n})`);
      }
      if (hits.length === 0 && key !== 'assistantMessage') {
        problems.push({
          scope: 'selectors.config',
          severity: 'error',
          message: `${key} matched nothing on ${PAGES[0].demoUrl} -- nothing to drive`,
        });
      } else if (hits.length > 0) {
        console.log(`  [i] ${key} matches: ${hits.join(', ')}`);
        if (key === 'assistantMessage' && hits.some((h) => !h.startsWith('.copilotKit') && !h.startsWith('[data-'))) {
          problems.push({
            scope: 'selectors.config',
            severity: 'warning',
            message: `assistantMessage already matches elements before any reply (${hits.join(', ')}) -- a loose alternative may make every reply look complete the instant it starts`,
          });
        }
      }
    }

    const submitCount = await p.locator(SELECTORS.chatSubmit).count().catch(() => 0);
    if (submitCount === 0) {
      problems.push({
        scope: 'selectors.config',
        severity: 'warning',
        message: `chatSubmit matched nothing on ${PAGES[0].demoUrl}; prompts will submit via the Enter key (fine, but the cursor never visibly clicks Send)`,
      });
    }
  } catch (e) {
    problems.push({
      scope: 'selectors.config',
      severity: 'warning',
      message: `could not probe selectors: ${e instanceof Error ? e.message : String(e)}`,
    });
  } finally {
    await browser.close().catch(() => {});
  }
}

/** @returns Process exit code: 1 if any error was found, else 0. */
export async function runDoctor(
  rootDir: string,
  opts: { online?: boolean } = {},
): Promise<number> {
  const problems: Problem[] = [];

  checkProject(problems);
  checkSelectors(problems);
  checkPages(rootDir, problems);
  checkCliFlows(problems);
  checkCliVideos(rootDir, problems);
  if (opts.online) await checkOnline(problems);

  const errors = problems.filter((p) => p.severity === 'error');
  const warnings = problems.filter((p) => p.severity === 'warning');

  console.log(`\n=== AUTORECORDER DOCTOR ===`);
  console.log(`  project : ${PROJECT.frameworkLabel} (${PROJECT.framework})`);
  console.log(`  docs    : ${PROJECT.docBaseUrl}`);
  console.log(`  pages   : ${PAGES.length}`);
  console.log(`  cli     : ${CLI_FLOWS.length} flow(s)`);
  console.log(`  mode    : ${opts.online ? 'static + online' : 'static (pass --online for live probes)'}\n`);

  if (problems.length === 0) {
    console.log(`  [ok] Adaptation is complete and consistent.\n`);
    return 0;
  }

  for (const p of problems) {
    console.log(`  ${p.severity === 'error' ? '[x]' : '[!]'} ${p.scope}: ${p.message}`);
  }

  console.log(`\n  ${errors.length} error(s), ${warnings.length} warning(s)`);
  console.log(
    errors.length > 0
      ? `  Adaptation is NOT complete. See ADAPT.md.\n`
      : `  No blocking errors; review the warnings above.\n`,
  );

  return errors.length > 0 ? 1 : 0;
}
