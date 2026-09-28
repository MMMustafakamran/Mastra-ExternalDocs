import { existsSync, mkdirSync, rmSync, unlinkSync } from 'node:fs';
import { basename, join } from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { executePageAction } from '../actions';
import { diagnoseError } from './diagnostics';
import { PROJECT } from '../config/project.config';
import { SELECTORS } from '../config/selectors.config';
import { castDuration, compressCast, type Cast } from './cli/cast';
import {
  ServiceStartError,
  startService,
  type RunningService,
} from './cli/service';
import { generateTerminalHtml } from './cli/terminal';
import { breakingErrors, captureConsole, type ConsoleEntry } from './console-capture';
import {
  buildFailureEvidence,
  evidenceCast,
  snapshotLogOffsets,
  writeFailureLog,
  type LogSource,
} from './failure-evidence';
import { runCommandsCast, snippetProbes } from './doc-snippets';
import { generateIdeHtml, type IdeTabConfig } from './ide/generator';
import { closeNotepad, openNotepad, typeInNotepad } from './overlays/notepad';
import { humanClick, humanGlide, humanScrollDown, restCursorSomewhere, sleep } from './overlays/cursor';
import { between, jitter, pause, seedTake } from './overlays/human';
import { clickTaskbarApp, ensureOverlays, waitForHydration } from './overlays/taskbar';
import { timeoutsFor } from './timeouts';
import { type ActionContext, type PageRecordConfig, type RecorderTimeouts } from './types';

/**
 * Smoothly and visibly scrolls the simulated VS Code .code-viewport down to the target startLine.
 *
 * `viewIdx` targets one specific tab's viewport by id. A selector list such as
 * `.editor-body-view:not([style*="display: none"]) .code-viewport, .code-viewport`
 * does NOT work here: querySelector resolves a selector list in document order,
 * not list order, so it returns tab 0's (hidden) viewport whenever a later tab
 * is active -- which silently scrolled the wrong pane on every extra tab.
 */
async function humanScrollCodeViewport(
  page: Page,
  startLine: number,
  viewIdx: number,
): Promise<void> {
  if (startLine <= 14) {
    await sleep(300);
    return;
  }

  // Calculate target scrollTop: each line is 22px in height
  // Center the highlighted range in the editor pane
  const targetScrollTop = Math.max(0, (startLine - 8) * 22);

  await page.evaluate(async ({ targetY, idx }) => {
    const viewport = document.querySelector(
      `#ide-view-${idx} .code-viewport`,
    ) as HTMLElement | null;
    if (!viewport) return;

    const startY = viewport.scrollTop;
    const distance = targetY - startY;
    if (Math.abs(distance) < 15) return;

    const steps = 32;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      // Smooth cubic ease-in-out
      const progress =
        t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      viewport.scrollTop = startY + distance * progress;
      await new Promise((r) => setTimeout(r, 20));
    }
  }, { targetY: targetScrollTop, idx: viewIdx });

  await sleep(350);
}

/** Current scroll offset of the doc page's scroller (or the window). */
async function docScrollTop(page: Page): Promise<number> {
  return page
    .evaluate(() => {
      const el = (window as any).__autorecordScroller as HTMLElement | null;
      return el ? el.scrollTop : window.scrollY;
    })
    .catch(() => 0);
}

/**
 * Scrolls the doc page back up so its first real code block sits in the upper
 * half of the viewport, and returns that block's on-screen box. Uses the same
 * scroller `humanScrollDown` resolved, smoothly, so it reads as the reader
 * going back for the code. Null when the page has no code block.
 */
async function scrollDocCodeBlockIntoView(
  page: Page,
): Promise<{ x: number; y: number; width: number; height: number } | null> {
  const found = await page
    .evaluate((sel) => {
      const scroller = ((window as any).__autorecordScroller as HTMLElement | null) ?? null;
      const pres = Array.from(document.querySelectorAll(sel)).filter((el) => {
        const r = el.getBoundingClientRect();
        return r.height > 60 && r.width > 200;
      });
      const pre = pres[0] as HTMLElement | undefined;
      if (!pre) return false;
      const r = pre.getBoundingClientRect();
      const wanted = 160; // where the block's top should land
      if (scroller) scroller.scrollTo({ top: scroller.scrollTop + r.top - wanted, behavior: 'smooth' });
      else window.scrollTo({ top: window.scrollY + r.top - wanted, behavior: 'smooth' });
      (window as any).__autorecordDocCode = pre;
      return true;
    }, SELECTORS.docCodeBlock)
    .catch(() => false);
  if (!found) return null;
  await sleep(900);
  return page
    .evaluate(() => {
      const pre = (window as any).__autorecordDocCode as HTMLElement | null;
      if (!pre) return null;
      const r = pre.getBoundingClientRect();
      return { x: r.left, y: r.top, width: r.width, height: r.height };
    })
    .catch(() => null);
}

/**
 * Selects a doc-page code block the way a reader does: press at its first
 * line, drag to its last. The selection is the browser's own -- extended with
 * `caretRangeFromPoint` under the cursor on every step -- so it paints exactly
 * as a real drag would on that site. A page that refuses selection (user-select:
 * none) gets the other gesture a reader makes: the cursor circling the block.
 * Either way about a second.
 */
async function dragSelectDocCode(
  page: Page,
  box: { x: number; y: number; width: number; height: number },
): Promise<void> {
  const pad = 12;
  const x0 = box.x + pad + 2;
  const y0 = box.y + 10;
  const y1 = Math.min(box.y + box.height - pad - 4, 1010);
  const x1 = box.x + Math.min(box.width - pad, pad + 460);
  await humanGlide(page, x0, y0, 18);
  await sleep(between(60, 140));
  await page.evaluate(`(function(){var c=document.getElementById('playwright-virtual-mouse');if(c)c.style.transform='translate(-4px, -2px) scale(0.9)';})()`).catch(() => {});

  const steps = 16;
  const stepMs = Math.min(70, Math.max(30, 950 / steps));
  let selecting = true;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = x0 + (x1 - x0) * t + between(-3, 3);
    const y = y0 + (y1 - y0) * t;
    const selected = (await page
      .evaluate(
        ({ sx, sy, x, y }) => {
          const c = document.getElementById('playwright-virtual-mouse');
          if (c) {
            c.style.left = x.toFixed(1) + 'px';
            c.style.top = y.toFixed(1) + 'px';
          }
          const pre = (window as any).__autorecordDocCode as HTMLElement | null;
          const sel = window.getSelection();
          const from = (document as any).caretRangeFromPoint?.(sx, sy) as Range | null;
          const to = (document as any).caretRangeFromPoint?.(x, y) as Range | null;
          if (!pre || !sel || !from || !to || !pre.contains(to.startContainer)) return sel ? sel.toString().length : 0;
          const range = document.createRange();
          range.setStart(from.startContainer, from.startOffset);
          range.setEnd(to.startContainer, to.startOffset);
          sel.removeAllRanges();
          sel.addRange(range);
          return sel.toString().length;
        },
        { sx: x0, sy: y0, x, y },
      )
      .catch(() => 0)) as number;
    if (i === 4 && selected === 0) {
      selecting = false;
      break;
    }
    await sleep(jitter(stepMs, 0.35));
  }
  await sleep(between(50, 110));
  await page.evaluate(`(function(){var c=document.getElementById('playwright-virtual-mouse');if(c)c.style.transform='translate(-4px, -2px) scale(1)';})()`).catch(() => {});

  if (!selecting) {
    // Nothing selectable here: circle the block twice instead, loosely.
    const cx = box.x + Math.min(box.width / 2, 320);
    const cy = box.y + box.height / 2;
    const rx = Math.min(box.width / 2 - 10, 300);
    const ry = Math.min(box.height / 2 + 6, 120);
    for (let k = 0; k < 2; k++) {
      for (let a = 0; a <= 8; a++) {
        const ang = (a / 8) * Math.PI * 2;
        await humanGlide(page, cx + rx * Math.cos(ang) + between(-6, 6), cy + ry * Math.sin(ang) + between(-4, 4), 6);
      }
    }
  }
}

/**
 * A short fade as a simulated window comes up.
 *
 * The Notepad already opens with one; the IDE and the terminal appeared in a
 * single frame, which is how a navigation looks and not how an app switch
 * does. 180ms is under a real window animation and over one frame.
 */
function withWindowFade(html: string): string {
  const style =
    '<style>@keyframes __arWinIn{from{opacity:0;transform:scale(.992)}to{opacity:1;transform:none}}' +
    'body{animation:__arWinIn .18s ease-out both}</style>';
  return html.includes('</head>') ? html.replace('</head>', `${style}</head>`) : style + html;
}

/**
 * Virtual path the simulated IDE is served from, on the frontend's own origin.
 * Intercepted by Playwright and fulfilled from memory -- it never reaches Next.js.
 */
const IDE_ROUTE_PATH = '/__autorecord_ide__';

/** Same trick for the terminal window: served from memory, never from Next.js. */
const TERMINAL_ROUTE_PATH = '/__autorecord_terminal__';

/** One terminal segment of a CLI video. */
export interface CliRecordSegment {
  /** The captured session to replay. Compress it before passing it in. */
  cast: Cast;
  /** Terminal title-bar text. Defaults to the cast's own title. */
  title?: string;
}

/** What `recordCliFlow` needs: captured sessions and where they came from. */
export interface CliRecordRequest {
  /** Flow id, for logs. */
  id: string;
  /** Human title, for logs. */
  name: string;
  /** Video filename stem, without extension. */
  filename: string;
  /**
   * Sessions to replay, in order, in one terminal window.
   *
   * More than one so a single video can carry a whole set — four package
   * managers installing the same project belong in one clip, not four, because
   * the point of the matrix is the comparison between them.
   */
  segments: CliRecordSegment[];
  /** Doc page to open before the terminal, when the flow names one. */
  docUrl?: string;

  /**
   * Folder under `videos/` to write into.
   *
   * CLI clips keep to their own: they are a different kind of artifact from the
   * per-doc-page recordings, and mixing them makes the directory useless for
   * finding either.
   */
  subdir?: string;

  /**
   * Source files shown in the simulated IDE before the terminal.
   *
   * For a finding, this is where "installed versus declared" lives — the
   * resolved versions next to the manifest that declared them, and the line
   * that actually breaks. A terminal error on its own says something failed;
   * these say what it was running against.
   */
  ideTabs?: IdeTabConfig[];

  /** Seconds to dwell on each IDE tab. */
  ideDwellMs?: number;

  /**
   * A written explanation, typed into Notepad at the end of the take.
   *
   * The clip has to survive being watched by someone who was not here. A
   * terminal error explains what happened; this explains why it happened and
   * what it means, in the recording rather than in a separate document that
   * will drift away from it.
   */
  notepad?: { filename: string; body: string; charDelayMs?: number };
}

/** Result of one page recording, with hard failures separated from cosmetic notes. */
export interface RecordResult {
  success: boolean;
  filename: string;
  error?: string;
  warnings: string[];
  /** Browser console errors seen during the take, deduplicated. */
  consoleErrors?: string[];
}

/**
 * One line per distinct console error, for the result and the summary.
 *
 * A React error boundary logs the same failure a dozen times over; twelve
 * copies in the summary read as noise rather than as the finding.
 */
function distinctErrors(entries: ConsoleEntry[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const e of entries) {
    if (e.level !== 'error' || seen.has(e.text)) continue;
    seen.add(e.text);
    out.push(e.source ? `${e.text} (${e.source})` : e.text);
  }
  return out;
}

export class RecordingEngine {
  private readonly videosDir: string;
  private readonly rootDir: string;
  private readonly tempVideoDir: string;
  /**
   * One Chromium for the whole run. Every take used to launch and tear down
   * its own browser, which cost about five seconds per page off camera; the
   * context (and with it the video) is still fresh per take, so the clips are
   * unchanged. `shutdown()` closes it once the suite is done.
   */
  private browser?: Browser;

  constructor(rootDir: string) {
    this.rootDir = rootDir;
    this.videosDir = join(rootDir, 'autorecorder', 'videos');
    this.tempVideoDir = join(this.videosDir, '.temp_chunks');
    if (!existsSync(this.videosDir)) {
      mkdirSync(this.videosDir, { recursive: true });
    }
    if (!existsSync(this.tempVideoDir)) {
      mkdirSync(this.tempVideoDir, { recursive: true });
    }
  }

  /**
   * Launches the browser and opens a video-recording page.
   *
   * Shared by page recordings and CLI recordings so both produce video with
   * identical launch flags, viewport and colour scheme — a terminal clip that
   * differed in any of those would cut against the rest of the suite.
   */
  private async openStage(warmUrl?: string): Promise<{
    browser: Browser;
    context: BrowserContext;
    page: Page;
  }> {
    if (!this.browser || !this.browser.isConnected()) {
      this.browser = await chromium.launch({
        headless: false,
        args: [
          '--start-maximized',
          '--force-dark-mode',
          '--background-color=#1e1e1e',
        ],
      });
    }
    const browser = this.browser;

    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      colorScheme: 'dark',
      recordVideo: {
        dir: this.tempVideoDir,
        size: { width: 1920, height: 1080 },
      },
    });

    // Playwright starts recording the moment a page is created, so however long
    // the first navigation takes is dead footage at the head of every video.
    // Warming the doc URL in a throwaway page of the same context primes DNS,
    // TLS and the HTTP cache, which measured 1717ms -> 843ms on the real page.
    if (warmUrl) {
      const warmup = await context.newPage();
      await warmup
        .goto(warmUrl, { waitUntil: 'domcontentloaded', timeout: 20000 })
        .catch(() => {});
      const warmupVideo = warmup.video();
      await warmup.close().catch(() => {});
      await warmupVideo?.delete().catch(() => {});
    }

    const page = await context.newPage();

    // about:blank computes to rgba(0,0,0,0) and paints pure black regardless of
    // --background-color, so the residual lead-in reads as a black screen.
    // Paint it VS Code grey instead, so the head of the video looks deliberate.
    await page
      .evaluate(() => {
        document.documentElement.style.background = '#1e1e1e';
        if (document.body) document.body.style.background = '#1e1e1e';
      })
      .catch(() => {});

    return { browser, context, page };
  }

  /**
   * Saves the recorded video and tears the browser down.
   *
   * Returns the filename actually written, which is what the summary reports.
   */
  private async closeStage(
    browser: Browser,
    context: BrowserContext,
    page: Page,
    baseFilename: string,
    announceSuccess: boolean,
    subdir?: string,
  ): Promise<string> {
    const video = page.video();
    await page.close().catch(() => {});
    await context.close().catch(() => {});

    let savedFilename = '';
    if (video) {
      savedFilename = `${baseFilename}.webm`;
      // CLI recordings land in their own folder: they are a different kind of
      // artifact from the per-doc-page clips, and mixing them makes a directory
      // listing useless for finding either.
      const targetDir = subdir ? join(this.videosDir, subdir) : this.videosDir;
      mkdirSync(targetDir, { recursive: true });
      const finalWebm = join(targetDir, savedFilename);
      try {
        if (existsSync(finalWebm)) unlinkSync(finalWebm);
        await video.saveAs(finalWebm);
        await video.delete().catch(() => {});
        if (announceSuccess) {
          console.log(`\n🎥 [RECORDING SUCCESSFUL]: ${finalWebm}\n`);
        }
      } catch (err) {
        console.warn(`Video save note: ${err}`);
      }
    }

    // The browser stays up for the next take; see `shutdown()`.
    void browser;

    // Playwright's raw chunk lands here before saveAs moves it out. Nothing
    // should survive the run; left alone it accumulated one stray .webm per
    // recording, gitignored and invisible.
    try {
      rmSync(this.tempVideoDir, { recursive: true, force: true });
    } catch {}

    return savedFilename;
  }

  /**
   * Selects lines `from..to` of IDE view `idx` the way a person does: cursor
   * to the start of the first line, press, drag down the lines, release. The
   * highlight follows the cursor line by line (window.selectIdeLines in the
   * IDE template). Returns the milliseconds it took, so the caller can take
   * them out of the dwell that follows. Falls back to painting the range at
   * once if the lines cannot be found, so a take never loses its highlight.
   */
  private async dragSelectSnippet(page: Page, idx: number, from: number, to: number): Promise<number> {
    const started = Date.now();
    const rowBox = async (n: number) => {
      const row = page.locator(`#ide-view-${idx} .code-line[data-line="${n}"] .line-content`);
      return (await row.isVisible({ timeout: 1500 }).catch(() => false)) ? row.boundingBox() : null;
    };
    const first = await rowBox(from);
    const lastVisible = await rowBox(to);
    const paint = (upTo: number) =>
      page.evaluate(`window.selectIdeLines && window.selectIdeLines(${idx}, ${from}, ${upTo})`).catch(() => {});

    if (!first) {
      await paint(to);
      await humanGlide(page, 520, 360, 18);
      return Date.now() - started;
    }

    // Press at the start of the first line.
    await humanGlide(page, first.x + 6, first.y + first.height / 2, 18);
    await sleep(between(60, 140));
    await page.evaluate(`(function(){var c=document.getElementById('playwright-virtual-mouse');if(c)c.style.transform='translate(-4px, -2px) scale(0.9)';})()`).catch(() => {});
    await paint(from);

    // Drag down: one visual step per line, faster on long ranges, a little
    // uneven like a hand on a mouse. Whole selection bounded at ~1.2s.
    const lines = Math.max(1, to - from);
    const stepMs = Math.min(45, Math.max(14, 1100 / lines));
    const bottom = lastVisible ? lastVisible.y + lastVisible.height / 2 : first.y + lines * first.height;
    for (let n = from + 1; n <= to; n++) {
      const t = (n - from) / lines;
      const y = first.y + first.height / 2 + (bottom - first.y - first.height / 2) * t;
      const x = first.x + 6 + Math.min(240, (n - from) * 9) + between(-3, 3);
      await page.evaluate(`(function(){var c=document.getElementById('playwright-virtual-mouse');if(c){c.style.left='${x.toFixed(1)}px';c.style.top='${y.toFixed(1)}px';}})()`).catch(() => {});
      await paint(n);
      await sleep(jitter(stepMs, 0.35));
    }

    // Release, and leave the cursor resting on the selection.
    await sleep(between(50, 110));
    await page.evaluate(`(function(){var c=document.getElementById('playwright-virtual-mouse');if(c)c.style.transform='translate(-4px, -2px) scale(1)';})()`).catch(() => {});
    return Date.now() - started;
  }

  /** Closes the shared browser. Call once, after the last take. */
  async shutdown(): Promise<void> {
    const browser = this.browser;
    this.browser = undefined;
    if (browser) await browser.close().catch(() => {});
  }

  /**
   * Step 1 of every take: the doc page, read at human pace, then a taskbar
   * click to whatever comes next.
   *
   * Shared by page and CLI recordings. It used to be written out twice, and the
   * two copies had already drifted apart (different scroll depths, one with the
   * code-block glide and one without).
   *
   * @returns null on success, else a note for `warnings`. The doc site is
   *   external and not the thing under test, so a bad fetch degrades the intro
   *   rather than invalidating the recording.
   */
  private async showDocPage(
    page: Page,
    docUrl: string,
    nextApp: 'vscode' | 'chrome' | 'terminal',
    timeouts: RecorderTimeouts,
    snippets?: string[][],
  ): Promise<string | null> {
    console.log(`\n📖 Step 1: Navigating to Official Doc (${docUrl})...`);
    try {
      await page.goto(docUrl, { waitUntil: 'domcontentloaded', timeout: timeouts.docNavMs });

      // Fast check for doc header / content readiness
      await page
        .waitForSelector(SELECTORS.docContentReady, { state: 'visible', timeout: 5000 })
        .catch(() => {});

      // Overlays go on immediately so the taskbar is present from the first
      // frame. They survive hydration on their own now -- ensureOverlays
      // installs a MutationObserver that re-attaches them if React deletes
      // them while reconciling <html>.
      await ensureOverlays(page, 'chrome');

      // Scrolling is the part that must wait: a hydration remount snaps the
      // page back to the top mid-scroll. Start the wait now and let the intro
      // play over it rather than stalling on a frozen frame.
      const hydration = waitForHydration(page, 15000);

      // Crisp pause so viewer registers the doc title, then glide straight into reading
      await sleep(500);
      await humanGlide(page, 960, 380, 16);

      // Snippet mode waits at most 1.5s: the reader should be moving, not idle.
      const hydrated = snippets?.length
        ? await Promise.race([hydration, sleep(1500).then(() => false)])
        : await hydration;
      if (!hydrated) {
        console.warn(`   ⚠️ Doc page hydration not observed; scrolling anyway.`);
      }

      // Snippet mode: scroll down to each doc block the IDE step will show, in
      // the same order, and select it. No skim to the bottom.
      if (snippets?.length) {
        // Dark doc themes paint the default selection almost invisibly.
        await page
          .addStyleTag({ content: '::selection { background: rgba(56, 139, 253, 0.55) !important; color: inherit; }' })
          .catch(() => {});
        await pause(600);
        const missing: string[] = [];
        for (const [i, probes] of snippets.entries()) {
          const box = await this.revealDocSnippet(page, probes);
          if (!box) {
            missing.push(`#${i + 1}`);
            continue;
          }
          console.log(`   📌 Doc snippet ${i + 1}/${snippets.length} found; selecting it...`);
          await pause(1100);
          await dragSelectDocCode(page, box);
          await pause(1600);
          await page.evaluate(() => window.getSelection()?.removeAllRanges()).catch(() => {});
        }
        console.log(`   🖱️ Switching to ${nextApp} via Windows 11 Taskbar...`);
        await clickTaskbarApp(page, nextApp);
        return missing.length
          ? `Doc page: IDE snippet(s) ${missing.join(', ')} not found on the live page -- the doc may have changed`
          : null;
      }

      // Skim the whole page to the bottom in wheel bursts, so the clip shows
      // all of the doc, then come back up to its first code block.
      console.log(`   Skimming the doc page to the bottom...`);
      await humanScrollDown(page, 20000, 4500, { toBottom: true });
      // A late hydration remount resets the scroller to the top. If that
      // happened under the skim, do it once more now that the page is settled.
      if ((await docScrollTop(page)) < 200) {
        console.log(`   Page snapped back to the top (late hydration); skimming again...`);
        await pause(400);
        await humanScrollDown(page, 20000, 4500, { toBottom: true });
      }
      await pause(500);
      const codeBox = await scrollDocCodeBlockIntoView(page);
      if (codeBox) {
        // Select the snippet on the doc page with the cursor -- the same
        // gesture the IDE step makes on the project file a moment later, so
        // the two read as "this code, in our file".
        await dragSelectDocCode(page, codeBox);
      } else {
        await humanGlide(page, 650, 450, 18);
      }
      // A beat on the selected snippet before switching apps.
      await pause(900);

      console.log(`   🖱️ Switching to ${nextApp} via Windows 11 Taskbar...`);
      await clickTaskbarApp(page, nextApp);
      return null;
    } catch (e) {
      const note = `Doc page (${docUrl}): ${diagnoseError(e, 'doc-page')}`;
      console.warn(`⚠️ Doc navigation notice -- ${note}`);
      await sleep(600);
      return note;
    }
  }

  /**
   * Finds the doc code block holding an IDE snippet's probe lines, opens its
   * tab if it sits in a hidden one, and scrolls slowly until it is near the
   * top. Returns its box, or null when no block on the page contains them.
   */
  private async revealDocSnippet(
    page: Page,
    probes: string[],
  ): Promise<{ x: number; y: number; width: number; height: number } | null> {
    if (!probes.length) return null;
    const found = await page
      .evaluate((probes: string[]) => {
        // No named function consts in here: tsx wraps them in a __name()
        // helper that does not exist in the page.
        const need = Math.min(2, probes.length);
        const pre = Array.from(document.querySelectorAll('pre')).find((b) => {
          const t = (b.textContent || '').replace(/\s+/g, ' ');
          return probes.filter((p) => t.includes(p)).length >= need;
        });
        if (!pre) return false;
        if (pre.getBoundingClientRect().height === 0) {
          // mkdocs-material tabs
          const block = pre.closest('.tabbed-block');
          const set = block?.closest('.tabbed-set');
          if (block && set) {
            const idx = Array.from(set.querySelectorAll('.tabbed-block')).indexOf(block);
            (set.querySelectorAll('.tabbed-labels > label')[idx] as HTMLElement | undefined)?.click();
          }
          // ARIA tabs
          const panel = pre.closest('[role="tabpanel"]');
          if (panel?.id) {
            (document.querySelector(`[role="tab"][aria-controls="${panel.id}"]`) as HTMLElement | null)?.click();
          }
        }
        (window as any).__autorecordDocCode = pre;
        return true;
      }, probes)
      .catch(() => false);
    if (!found) return null;
    await sleep(400);

    await page
      .evaluate(() => {
        const pre = (window as any).__autorecordDocCode as HTMLElement;
        let scroller: HTMLElement | null = pre.parentElement;
        while (scroller && scroller !== document.body) {
          const oy = getComputedStyle(scroller).overflowY;
          if ((oy === 'auto' || oy === 'scroll') && scroller.scrollHeight > scroller.clientHeight) break;
          scroller = scroller.parentElement;
        }
        const el = scroller && scroller !== document.body ? scroller : (document.scrollingElement as HTMLElement);
        const top = el === document.scrollingElement ? 0 : el.getBoundingClientRect().top;
        const from = el.scrollTop;
        const dist = pre.getBoundingClientRect().top - top - 140;
        const ms = Math.min(2600, Math.max(700, Math.abs(dist) * 0.9));
        return new Promise<void>((done) => {
          const t0 = performance.now();
          (window as any).__autorecordScrollTick = (now: number) => {
            const t = Math.min(1, (now - t0) / ms);
            el.scrollTop = from + dist * (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
            if (t < 1) requestAnimationFrame((window as any).__autorecordScrollTick);
            else done();
          };
          requestAnimationFrame((window as any).__autorecordScrollTick);
        });
      })
      .catch(() => {});
    await sleep(350);

    return page
      .evaluate(() => {
        const r = ((window as any).__autorecordDocCode as HTMLElement).getBoundingClientRect();
        return r.height > 0 ? { x: r.left, y: r.top, width: r.width, height: r.height } : null;
      })
      .catch(() => null);
  }

  /**
   * Step 2: the simulated IDE, one tab per file, each scrolled to and rested on
   * its highlighted range.
   *
   * Served from `origin` via an intercepted route and navigated to, rather
   * than document.write()-ed into the doc page. document.write leaves the
   * document's URL as the doc URL, so the doc page is only ever one renderer
   * hiccup away from resurfacing -- and because the IDE HTML wipes the doc's
   * <link> tags, when it does come back it comes back unstyled. A real
   * navigation destroys that document outright. It also makes the IDE -> demo
   * hop a SAME-ORIGIN navigation, so there is no cross-origin process swap. The
   * response is fulfilled from memory, and the IDE paints #1e1e1e -- matching
   * the browser's --background-color launch arg, so there is no white flash.
   *
   * Throws on failure: the IDE view is generated from local files, so a
   * failure here is a real defect in this repo, never a flaky-network excuse.
   */
  private async showIde(
    page: Page,
    tabs: IdeTabConfig[],
    origin: string,
    opts: { dwellMs: number; clickTabs: boolean },
  ): Promise<void> {
    const [first, ...extra] = tabs;
    const ideHtml = await generateIdeHtml(
      this.rootDir,
      first.filePath,
      first.startLine,
      first.endLine,
      extra,
      0,
    );
    const ideUrl = new URL(IDE_ROUTE_PATH, origin).toString();
    await page.route(ideUrl, (route) =>
      route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: withWindowFade(ideHtml) }),
    );
    await page.goto(ideUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await ensureOverlays(page, 'vscode');
    await sleep(300);

    for (let idx = 0; idx < tabs.length; idx++) {
      if (idx > 0) {
        console.log(`   🖱️ Switching tab to ${basename(tabs[idx].filePath)} in VS Code...`);
        const tabLocator = page.locator(`#ide-tab-${idx}`);
        const tBox = opts.clickTabs && (await tabLocator.isVisible().catch(() => false))
          ? await tabLocator.boundingBox()
          : null;
        if (tBox) {
          await humanGlide(page, tBox.x + tBox.width / 2, tBox.y + tBox.height / 2, 18);
          await humanClick(page);
        } else {
          await page.evaluate(`window.switchIdeTab && window.switchIdeTab(${idx})`);
        }
        await sleep(idx > 0 && !opts.clickTabs ? 500 : 300);
      }

      // Scroll, then select the snippet by hand -- scoped to the active tab.
      await humanScrollCodeViewport(page, tabs[idx].startLine, idx);
      const dragMs = await this.dragSelectSnippet(page, idx, tabs[idx].startLine, tabs[idx].endLine);
      // The drag is time spent looking at the code, so it comes out of the
      // dwell rather than on top of it; the take stays the same length.
      await pause(Math.max(600, opts.dwellMs - dragMs));
    }

    // Bounded, because unbounded it can hang the whole run. `unroute` waits for
    // in-flight handlers of the route it removes, and after some doc pages one
    // never settles: seen 4/4 on the Learning page, whose Loom embed is the one
    // thing it has that the others don't. The IDE window is finished with by
    // now either way, and a leftover handler on a URL nothing else requests is
    // harmless.
    await Promise.race([page.unroute(ideUrl).catch(() => {}), sleep(3000)]);
  }

  /**
   * Navigates to a terminal window and plays a cast through to the end.
   *
   * The frontend does not have to be running: the page is served by
   * intercepting a URL on the frontend's origin and fulfilling it from memory,
   * exactly as the simulated IDE is, so nothing reaches the network.
   *
   * Replay is driven inside the page rather than by writing bytes over CDP,
   * which would put a round trip between every character.
   */
  private async playCastInTerminal(
    page: Page,
    opts: { cast: Cast; title?: string; origin?: string },
  ): Promise<void> {
    const terminalHtml = withWindowFade(generateTerminalHtml({ cast: opts.cast, title: opts.title }));
    const terminalUrl = new URL(
      TERMINAL_ROUTE_PATH,
      opts.origin ?? PROJECT.frontendUrl,
    ).toString();

    await page.route(terminalUrl, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: terminalHtml,
      }),
    );
    await page.goto(terminalUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await ensureOverlays(page, 'terminal');
    await sleep(400);

    await page.evaluate(`window.__startCastReplay && window.__startCastReplay()`);

    // The replay's own duration plus slack. A cast that plays for four minutes
    // needs a wait longer than four minutes, so this cannot be a constant.
    const replayTimeoutMs = castDuration(opts.cast) * 1000 + 60_000;
    await page.waitForFunction(`window.__castReplayDone === true`, undefined, {
      timeout: replayTimeoutMs,
      polling: 250,
    });

    // The route stays registered for the life of the page; unrouting keeps a
    // second terminal segment on the same page from being served the first
    // one's HTML.
    // Bounded for the same reason as the IDE route above.
    await Promise.race([page.unroute(terminalUrl).catch(() => {}), sleep(3000)]);
  }

  /**
   * Closes a failed take on the evidence: the log file always, the terminal
   * window when the page can still be driven. Bounded, so a wedged page cannot
   * turn a 60-second failure into a 5-minute one.
   */
  private async showFailureEvidence(
    page: Page,
    pageId: string,
    error: string,
    consoleEntries: ConsoleEntry[],
    logs: LogSource[],
    logsDir: string,
  ): Promise<void> {
    let evidence;
    try {
      evidence = buildFailureEvidence({ pageId, error, consoleEntries, logs });
      const file = writeFailureLog(logsDir, evidence);
      console.log(`   📝 Failure evidence: ${file}`);
    } catch (e) {
      console.warn(`   Evidence note: could not write the error log: ${e}`);
      return;
    }
    if (page.isClosed()) return;
    try {
      await Promise.race([
        (async () => {
          await sleep(800);
          await this.playCastInTerminal(page, {
            cast: evidenceCast(evidence),
            title: `Error console — ${pageId}`,
          });
        })(),
        sleep(20_000).then(() => {
          throw new Error('evidence terminal did not finish in 20s');
        }),
      ]);
    } catch (e) {
      console.warn(`   Evidence note: terminal not shown on camera: ${e instanceof Error ? e.message : e}`);
    }
  }

  /**
   * Films a captured CLI session: the doc page it belongs to, then a terminal
   * window replaying the cast.
   *
   * Deliberately reads from a cast rather than driving a live terminal. The CLI
   * has already run, once, under `npm run capture` — this is the render pass,
   * so a re-shoot costs seconds and never re-scaffolds a project or asks anyone
   * to sign in again. See `core/cli/cast.ts`.
   */
  async recordCliFlow(req: CliRecordRequest): Promise<RecordResult> {
    console.log(`\n======================================================`);
    console.log(`🎬 RECORDING CLI: ${req.name} (${req.id})`);
    console.log(`======================================================`);

    seedTake(req.id);
    restCursorSomewhere();

    const warnings: string[] = [];
    const timeouts = timeoutsFor();
    let recordError: string | undefined;
    let finalSavedFilename = '';

    const { browser, context, page } = await this.openStage(req.docUrl);

    try {
      // ----------------------------------------------------
      // STEP 1: THE DOC PAGE THIS FLOW IS EVIDENCE FOR
      // ----------------------------------------------------
      if (req.docUrl) {
        const note = await this.showDocPage(
          page,
          req.docUrl,
          req.ideTabs?.length ? 'vscode' : 'terminal',
          timeouts,
        );
        if (note) warnings.push(note);
      }

      // ----------------------------------------------------
      // STEP 1b: THE CODE THE FINDING IS ABOUT
      // ----------------------------------------------------
      if (req.ideTabs?.length) {
        console.log(`\n💻 Step 1b: Showing ${req.ideTabs.length} file(s) in VS Code...`);
        await this.showIde(page, req.ideTabs, PROJECT.frontendUrl, {
          dwellMs: req.ideDwellMs ?? 3800,
          clickTabs: false,
        });
        console.log(`   🖱️ Switching to Terminal via Windows 11 Taskbar...`);
        await clickTaskbarApp(page, 'terminal');
      }

      // ----------------------------------------------------
      // STEP 2: TERMINAL WINDOW REPLAYING THE CAPTURED SESSION
      // ----------------------------------------------------
      for (const [i, segment] of req.segments.entries()) {
        console.log(
          `\n⌨️  Step 2.${i + 1}: Replaying ${segment.title ?? 'terminal cast'} ` +
            `(${segment.cast.events.length} events, ${castDuration(segment.cast).toFixed(1)}s)...`,
        );
        await this.playCastInTerminal(page, {
          cast: segment.cast,
          title: segment.title,
        });
      }

      console.log(`   ✅ Replay complete (${req.segments.length} segment(s)).`);

      // ----------------------------------------------------
      // STEP 3: THE FINDING, WRITTEN OUT
      // ----------------------------------------------------
      if (req.notepad) {
        console.log(`\n📝 Step 3: Writing the finding in Notepad...`);
        await openNotepad(page, req.notepad.filename);
        await typeInNotepad(page, req.notepad.body, { charDelayMs: req.notepad.charDelayMs });
        await closeNotepad(page);
      }
    } catch (e) {
      recordError = `CLI replay failed: ${diagnoseError(e, 'cli-replay')}`;
      console.error(`❌ ${recordError}`);
    } finally {
      finalSavedFilename = await this.closeStage(
        browser,
        context,
        page,
        req.filename,
        !recordError,
        req.subdir,
      );
    }

    return {
      success: !recordError,
      filename: finalSavedFilename,
      error: recordError,
      warnings,
    };
  }

  async recordPage(config: PageRecordConfig): Promise<RecordResult> {
    console.log(`\n======================================================`);
    console.log(`🎬 RECORDING: ${config.name} (${config.id})`);
    console.log(`======================================================`);

    seedTake(config.id);
    restCursorSomewhere();

    const timeouts = timeoutsFor(config);
    let recordSuccess = false;
    let recordError: string | undefined;
    let finalSavedFilename = '';
    const warnings: string[] = [];

    // Where the server logs stand as this take begins. If it fails, the
    // evidence shown is this page's slice of the logs, not the whole run's.
    const logsDir = join(this.videosDir, 'logs');
    const logSources: LogSource[] = snapshotLogOffsets(logsDir);

    /** A step that renders the thing under test failed -- the video is not usable. */
    const fail = (message: string): void => {
      if (!recordError) recordError = message;
    };

    // What the page handler reports. `fail` does not throw: the take runs to
    // the end so the clip still shows the failure, and the verdict is applied
    // once the handler returns.
    const actionFailures: string[] = [];
    const ctx: ActionContext = {
      warn: (message) => {
        warnings.push(message);
        console.log(`   ⚠️  ${message}`);
      },
      fail: (message) => {
        actionFailures.push(message);
        console.error(`   ❌ ${message}`);
      },
      timeouts,
    };

    // A page that brings its own dev server starts it before anything is filmed:
    // the boot cast has to exist before it can be replayed, and the app has to be
    // serving before the demo step reaches it. Failing here aborts the recording
    // rather than producing a full-length video of a connection refused.
    let service: RunningService | undefined;
    if (config.devServer) {
      try {
        service = await startService(
          {
            // The page the demo step opens is the page worth warming — see
            // `warmUrl` in service.ts. The port comes from where the demo will
            // be reached, so a squatter there is caught before anything is
            // filmed. Config may still override either.
            warmUrl: config.demoUrl,
            port: Number(new URL(config.devServer.originUrl).port) || undefined,
            ...config.devServer,
          },
          {
            rootDir: this.rootDir,
            title: config.devServer.title,
          },
        );
      } catch (e) {
        const detail = e instanceof ServiceStartError ? `\n${e.tail}` : '';
        const error = `Dev server failed to start: ${e instanceof Error ? e.message : String(e)}${detail}`;
        // No browser to film this in; the log file is the only evidence.
        try {
          writeFailureLog(logsDir, buildFailureEvidence({ pageId: config.id, error, logs: logSources }));
        } catch {}
        return { success: false, filename: '', error, warnings: [] };
      }
    }

    const { browser, context, page } = await this.openStage(config.docUrl);

    // Console errors, page errors and failed backend requests, kept rather than
    // printed and forgotten. They go on the result so the summary and the CI
    // report can show them next to the clip they belong to. Started at the
    // demo step, not here: the doc site's own console is not under test, and
    // it logs a dozen hydration errors of its own on every load.
    let console_: ReturnType<typeof captureConsole> | undefined;

    // Attach global dialog handler so unexpected alerts don't stall recordings
    page.on('dialog', async (dialog) => {
      console.log(`   [Dialog Event] "${dialog.message()}"`);
      await sleep(400);
      try {
        await dialog.accept();
      } catch {}
    });

    try {
      // ----------------------------------------------------
      // STEP 1: OFFICIAL DOC PAGE & HUMAN READING SCROLL
      // ----------------------------------------------------
      const ideTabs = config.showIde === false
        ? []
        : [
            { filePath: config.ideFile, startLine: config.startLine, endLine: config.endLine },
            ...(config.extraTabs ?? []),
          ];
      const runCast = runCommandsCast(this.rootDir, [
        { cmd: PROJECT.backendStartCmd, log: 'backend.log', ready: /running on|listening|ready|started/i },
        { cmd: PROJECT.frontendStartCmd, log: 'frontend.log', ready: /ready in|local:/i },
      ]);
      if (!runCast) warnings.push('Run commands not shown: no server logs from this run');
      const afterIde = runCast || service ? 'terminal' : 'chrome';

      const docNote = await this.showDocPage(
        page,
        config.docUrl,
        ideTabs.length ? 'vscode' : afterIde,
        timeouts,
        ideTabs.map((t) => snippetProbes(this.rootDir, t)),
      );
      if (docNote) warnings.push(docNote);

      // ----------------------------------------------------
      // STEP 2: THE SAME SNIPPETS IN VS CODE, IN THE SAME ORDER
      // ----------------------------------------------------
      if (ideTabs.length) {
        console.log(`\n💻 Step 2: Showing ${ideTabs.length} doc snippet(s) in VS Code...`);
        try {
          await this.showIde(page, ideTabs, config.demoUrl, {
            dwellMs: ideTabs.length > 1 ? 1500 : 1800,
            clickTabs: true,
          });
          console.log(`   🖱️ Switching to ${afterIde} via Windows 11 Taskbar...`);
          await clickTaskbarApp(page, afterIde);
        } catch (e) {
          const msg = `IDE view failed: ${diagnoseError(e, 'ide-simulation')}`;
          fail(msg);
          console.error(`❌ ${msg}`);
          await sleep(600);
        }
      }

      // ----------------------------------------------------
      // STEP 2a: THE COMMANDS THAT RUN THE PROJECT
      // ----------------------------------------------------
      if (runCast) {
        console.log(`\n⌨️  Step 2a: Showing the commands that run the project...`);
        try {
          await this.playCastInTerminal(page, { cast: runCast, title: 'Terminal', origin: config.demoUrl });
          if (!service) {
            console.log(`   🖱️ Switching back to Chrome via Windows 11 Taskbar...`);
            await clickTaskbarApp(page, 'chrome');
          }
        } catch (e) {
          warnings.push(`Run commands terminal: ${diagnoseError(e, 'cli-replay')}`);
        }
      }

      // ----------------------------------------------------
      // STEP 2b: THE DEV SERVER BOOTING, IN A TERMINAL
      // ----------------------------------------------------
      if (service) {
        console.log(
          `\n⌨️  Step 2b: Replaying dev server boot (${service.bootSeconds}s to ready)...`,
        );
        try {
          await this.playCastInTerminal(page, {
            cast: compressCast(service.cast, {
              maxGapSec: config.devServer?.render?.maxGapSec ?? 0.8,
              speed: config.devServer?.render?.speed ?? 1.6,
            }),
            title: config.devServer?.title,
          });
          console.log(`   🖱️ Switching back to Chrome via Windows 11 Taskbar...`);
          await clickTaskbarApp(page, 'chrome');
        } catch (e) {
          // The server is up — that was proven before filming started — so a
          // failure here is the replay, not the project. Note it and carry on to
          // the demo rather than throwing away a recording of a working app.
          const note = `Dev server terminal replay: ${diagnoseError(e, 'cli-replay')}`;
          warnings.push(note);
          console.warn(`⚠️ ${note}`);
        }
      }

      // ----------------------------------------------------
      // STEP 3: FRONTEND DEMO PAGE & TAILORED ACTION EXECUTION
      // ----------------------------------------------------
      console.log(`\n🚀 Step 3: Opening Demo (${config.demoUrl})...`);
      console_ = captureConsole(page);
      try {
        // Belt-and-braces: paint the outgoing document dark so that even a slow
        // demo compile holds on a dark frame rather than anything bright.
        await page.evaluate(`
          (function() {
            document.body.style.backgroundColor = '#0f172a';
            document.body.style.transition = 'none';
          })()
        `).catch(() => {});

        const response = await page.goto(config.demoUrl, {
          waitUntil: 'domcontentloaded',
          timeout: timeouts.demoNavMs,
        });

        // A 404/500 used to sail through as a PASS -- the route simply did not exist.
        const status = response?.status() ?? 0;
        if (status >= 400) {
          throw new Error(
            `Demo route returned HTTP ${status} (${config.demoUrl})`,
          );
        }

        // Our demo pages are App Router too, so React will delete the overlays
        // when it hydrates -- but the guard inside ensureOverlays re-attaches
        // them. No wait here: nothing scrolls this page, and if hydration has
        // already finished the probe would never fire and just burn its timeout.
        await ensureOverlays(page, 'chrome');

        // Wait for page body and chat element readiness
        console.log(`   ⏳ Waiting for Next.js compilation & React hydration to settle...`);
        await page.waitForSelector('body', { timeout: 10000 }).catch(() => {});

        // Next.js dev refuses its own chunks when the page is opened on a host
        // it does not list -- 127.0.0.1 instead of localhost, typically. The
        // page paints from the server render, React never hydrates, and the
        // take then spends two minutes retyping into a composer that cannot
        // submit. The 403s are on the console the moment the page loads, so
        // say what happened now rather than "agent never responded" later.
        const blocked = console_?.entries.find(
          (e) => /\/_next\/static\/.*(403|ERR_ABORTED)/.test(e.text) || /Blocked cross-origin/i.test(e.text),
        );
        if (blocked) {
          throw new Error(
            `Next.js dev server refused its own chunks (${blocked.text.slice(0, 120)}). ` +
              `The page will never hydrate. Open the frontend on the host Next lists as Local -- ` +
              `usually http://localhost:<port>, not 127.0.0.1 -- or add the host to allowedDevOrigins in next.config.`,
          );
        }
        // No .catch() here: if the demo never renders an interactive surface there
        // is nothing to record, and that must fail rather than warn.
        await page.waitForSelector(SELECTORS.chatReady, {
          state: 'visible',
          timeout: timeouts.chatReadyMs,
        });
        await sleep(1000);

        // Dispatch specific demo actions
        await executePageAction(page, config, this.rootDir, ctx);

        if (actionFailures.length > 0) {
          throw new Error(actionFailures.join('; '));
        }

        console.log(`✅ Demo execution completed for ${config.id}.`);
        await pause(1500);
      } catch (e) {
        const msg = `Demo step failed: ${diagnoseError(e, config.demoUrl)}`;
        fail(msg);
        console.error(`\n❌ [Demo Failure on ${config.id}]:\n${msg}\n`);
        await sleep(1000);
      }

      recordSuccess = !recordError;
    } catch (err: any) {
      recordError = err?.message || String(err);
      recordSuccess = false;
      console.error(`❌ Recording error for ${config.id}:`, recordError);
    } finally {
      console_?.stop();

      // The app throwing is a failure, not a footnote. It used to become one
      // warning line, so a page that crashed mid-take still reported PASS*.
      const breaking = distinctErrors(breakingErrors(console_?.entries ?? []));
      if (!recordError && breaking.length > 0) {
        recordError =
          `The app threw during the take (${breaking.length} distinct error(s)), first: ${breaking[0]}`;
        recordSuccess = false;
        console.error(`\n❌ [Page error on ${config.id}]: ${recordError}\n`);
      }

      // A failed take ends with the person opening the terminal to read what
      // went wrong: the diagnosed error, the browser console, and this page's
      // slice of the server logs, scrolled to the line that explains it. The
      // same text goes to videos/logs/<id>.error.log. Never lets an evidence
      // problem hide the original failure.
      if (recordError) {
        await this.showFailureEvidence(page, config.id, recordError, console_?.entries ?? [], logSources, logsDir);
      }

      finalSavedFilename = await this.closeStage(
        browser,
        context,
        page,
        config.filename ?? config.id,
        recordSuccess,
      );

      // Always, including on the failure paths above: a dev server left running
      // holds its port, and the next page in the run would find it occupied and
      // silently record against the previous package manager's app.
      if (service) {
        console.log(`   🛑 Stopping dev server...`);
        await service.stop();
      }
    }

    const consoleErrors = distinctErrors(console_?.entries ?? []);
    if (consoleErrors.length > 0) {
      warnings.push(
        `Browser console: ${consoleErrors.length} distinct error(s), first: ${consoleErrors[0]}`,
      );
    }

    return {
      success: recordSuccess,
      filename: finalSavedFilename,
      error: recordError,
      warnings,
      consoleErrors,
    };
  }
}
