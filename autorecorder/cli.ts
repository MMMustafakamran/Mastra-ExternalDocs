/**
 * Automated Screen Recording & Demonstration Pipeline
 * Entrypoint & CLI runner
 */
import { existsSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { PAGES, SKIP_RECORDING } from './config/pages.config';
import { PROJECT } from './config/project.config';
import { isCi } from './core/cli/ci-guard';
import { checkServicesHealth } from './core/diagnostics';
import { RecordingEngine } from './core/engine';
import { runDoctor } from './core/doctor';
import { prewarmDemoRoutes } from './core/prewarm';
import { parseShard, selectPages } from './core/select';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(__dirname, '..');
const VIDEOS_DIR = join(__dirname, 'videos');

/** Where the CLI pipeline's clips live, mirroring `cli-render.ts`. */
const CLI_VIDEO_SUBDIR = 'cli';

/**
 * Moves a finished `demo-<pm>` clip into `videos/cli/`.
 *
 * A demo is the *third* clip of a package manager's CLI set — the CLI run, the
 * install, then the app it produced — so it belongs beside the other two rather
 * than among the per-doc-page recordings. `cli-render.ts` writes its own clips
 * straight into that folder, but it records a demo by spawning this file with
 * `--pages=demo-<pm>`, and `recordPage` has nowhere to put a subdir: only
 * `recordCliFlow` takes one, and widening `PageRecordConfig` means editing
 * manifest-covered `core/types.ts`. Moving the finished file keeps the whole
 * set together without forking core.
 *
 * Returns the filename either way, so a page that is not a demo, or whose
 * recording produced no file, passes through untouched.
 */
function placeDemoWithCliClips(pageId: string, filename: string): string {
  if (!pageId.startsWith('demo-') || !filename) return filename;

  const from = join(VIDEOS_DIR, filename);
  if (!existsSync(from)) return filename;

  const targetDir = join(VIDEOS_DIR, CLI_VIDEO_SUBDIR);
  mkdirSync(targetDir, { recursive: true });
  const to = join(targetDir, filename);
  if (existsSync(to)) unlinkSync(to);
  renameSync(from, to);
  console.log(`   ↪ ${filename} -> videos/${CLI_VIDEO_SUBDIR}/`);

  return filename;
}

/**
 * Per-run results, next to the videos.
 *
 * Casts get a `*.report.json`; page recordings had nothing, so the CI report
 * listed every `.webm` in the folder and marked them all "Recorded" — a run
 * of one page reported five, four of them days old. This is what the report
 * reads instead.
 */
export const RESULTS_FILE = 'RECORD_RESULTS.json';

export interface PageResult {
  id: string;
  name: string;
  filename: string;
  success: boolean;
  durationSec: number;
  error?: string;
  warnings: string[];
  consoleErrors?: string[];
}

export interface RunResults {
  timestamp: string;
  args: string[];
  passed: number;
  failed: number;
  results: PageResult[];
}

/**
 * Both services must be up before any browser launches. Recording against a
 * dead backend produces a full-length video of a broken page, so this aborts
 * by default; `--force` records anyway when that is deliberately what you want.
 */
async function assertServicesUp(force: boolean): Promise<void> {
  const health = await checkServicesHealth();
  if (health.frontendOk && health.backendOk) return;

  console.error(`\n🔍 [Pre-flight Service Diagnostics]`);
  if (!health.backendOk) {
    console.error(
      `   [x] Agent backend ${PROJECT.backendUrl} unreachable: ${health.backendError}`,
    );
    console.error(`       Fix: ${PROJECT.backendStartCmd}`);
  }
  if (!health.frontendOk) {
    console.error(
      `   [x] Frontend ${PROJECT.frontendUrl} unreachable: ${health.frontendError}`,
    );
    console.error(`       Fix: ${PROJECT.frontendStartCmd}`);
  }

  if (force) {
    console.warn(`\n   ⚠️ --force given; recording anyway. Expect unusable video.\n`);
    return;
  }

  console.error(`\n❌ Aborting before launching a browser. Pass --force to override.\n`);
  process.exit(1);
}

function printUsage(): void {
  console.log(`
🎬 npm run record -- [selection] [options]

Selection (default: every page, in nav order)
  --<page-id>, <page-id>     one page, e.g. --quickstart
  --page=<id>                same thing, explicit form
  --pages=<id,id>            exactly these pages (--only= is an alias)
  --filter=<text>            pages whose id or name contains the text
  <word> [<word> ...]        same as --filter, for each word
  --limit=<n>                first n of the selection (--first=, --count=)
  --shard=<k>/<n>            slice k of n, for matrix workers

Options
  --list, -l                 print every registered page and exit
  --doctor                   validate the configuration; exits 1 on error
  --doctor --online          also probe every doc/demo URL and the selectors
  --force                    record even if the pre-flight health check fails
  --allow-ci                 on a runner, still record pages that boot a dev server
  --help, -h                 this text

Results go to videos/${RESULTS_FILE}; the process exits 1 if any page failed.
`);
}

function printList(): void {
  console.log(`\n📋 REGISTERED RECORDING ROUTES (${PAGES.length} total):\n`);
  for (let i = 0; i < PAGES.length; i++) {
    const p = PAGES[i];
    console.log(`  ${String(i + 1).padStart(2, ' ')}. [${p.id}] ${p.name}`);
    console.log(`      Command: npm run record -- --${p.id}`);
    console.log(`      Doc:     ${p.docUrl}`);
    console.log(`      Demo:    ${p.demoUrl}`);
    console.log(`      File:    ${p.ideFile} (lines ${p.startLine}-${p.endLine})`);
  }
  console.log('');
}

/** The switches this command knows. Anything else is a page id or a search word. */
const OPTIONS = {
  force: { type: 'boolean', default: false },
  list: { type: 'boolean', short: 'l', default: false },
  help: { type: 'boolean', short: 'h', default: false },
  doctor: { type: 'boolean', default: false },
  'verify-config': { type: 'boolean', default: false },
  online: { type: 'boolean', default: false },
  'allow-ci': { type: 'boolean', default: false },
  page: { type: 'string' },
  pages: { type: 'string' },
  only: { type: 'string' },
  filter: { type: 'string' },
  limit: { type: 'string' },
  first: { type: 'string' },
  count: { type: 'string' },
  shard: { type: 'string' },
} as const;

async function main(): Promise<void> {
  const rawArgs = process.argv.slice(2);

  // `strict: false` so `--quickstart` is accepted without being declared: it
  // arrives as an unknown boolean, and unknown booleans are page ids or search
  // words. Everything the command actually acts on is declared above, so a
  // typo in a real switch cannot fall through and become a page search.
  const { values, positionals } = parseArgs({
    args: rawArgs,
    options: OPTIONS,
    strict: false,
    allowPositionals: true,
  });

  if (values.help) {
    printUsage();
    return;
  }

  // Adaptation check. Static by default; --online also probes live URLs.
  if (values.doctor || values['verify-config']) {
    process.exit(await runDoctor(ROOT, { online: Boolean(values.online) }));
  }

  if (values.list || positionals.includes('list')) {
    printList();
    return;
  }

  const known = new Set(Object.keys(OPTIONS));
  const words = [
    ...Object.entries(values)
      .filter(([k, v]) => !known.has(k) && v === true)
      .map(([k]) => k),
    ...positionals.filter((p) => p !== 'list'),
  ].map((w) => w.replace(/^-+/, ''));

  const byId = (w: string): boolean => PAGES.some((p) => p.id.toLowerCase() === w.toLowerCase());
  const pageWord = words.find(byId);
  const queries = words.filter((w) => !byId(w));

  const limitRaw = values.limit ?? values.first ?? values.count;
  const limit = limitRaw ? Number.parseInt(String(limitRaw), 10) : undefined;
  const shard = parseShard(values.shard ? String(values.shard) : undefined);
  if (values.shard && !shard) {
    console.error(`❌ --shard expects K/N, got "${values.shard}"`);
    process.exit(1);
  }

  // Pages whose source files the CLI pipeline has not produced yet are dropped
  // from an unfiltered run. Recording them would boot a dev server in a
  // directory that does not exist and report four failures for work that simply
  // has not happened. Naming one explicitly still records it — and still fails,
  // which is the right answer to "record this specific thing that is missing".
  // On a runner, also drop any page that boots its own dev server. Those exist
  // to record the scaffolded apps, which only exist after the local-only CLI
  // pipeline has run — and booting one in CI would spend minutes waiting for a
  // server in a directory that was never created.
  const notYetProduced = PAGES.filter(
    (p) => p.generated && !existsSync(join(ROOT, p.ideFile)),
  );
  const ciExcluded =
    isCi() && !values['allow-ci']
      ? PAGES.filter((p) => p.devServer && !notYetProduced.includes(p))
      : [];
  const missingGenerated = [...notYetProduced, ...ciExcluded];

  // Pages listed in SKIP_RECORDING stay registered (doctor, CI groups, the
  // note) but are never recorded, by any selection, locally or in CI.
  const notRecorded = PAGES.filter((p) => p.id in SKIP_RECORDING);
  const recordable = PAGES.filter((p) => !(p.id in SKIP_RECORDING));
  for (const p of notRecorded) {
    console.log(`\n⏸️ Not recording ${p.id}: ${SKIP_RECORDING[p.id]}`);
  }

  const idList = values.pages ?? values.only;
  const { pages: targetPages, shard: applied } = selectPages(recordable, {
    ids: idList ? String(idList).split(',').map((s) => s.trim()).filter(Boolean) : undefined,
    page: values.page ? String(values.page) : pageWord,
    filter: values.filter ? String(values.filter) : undefined,
    queries,
    limit: limit && Number.isFinite(limit) ? limit : undefined,
    shard,
    excluded: new Set(missingGenerated.map((p) => p.id)),
  });

  if (applied) {
    console.log(
      `\n🧩 [Matrix Sharding]: Worker Shard ${applied.index}/${applied.total} -> Recording ${targetPages.length} pages (positions ${applied.positions.join(', ')})`,
    );
  }

  if (targetPages.length === 0) {
    if (applied) {
      console.log(`\nℹ️ [Matrix Sharding]: No pages assigned to this worker shard. Exiting cleanly.`);
      process.exit(0);
    }
    // Asking only for excluded pages is a no-op, not a bad selection: the ids
    // are real, so exiting 1 here would fail a run that did exactly as told.
    if (notRecorded.length > 0 && selectPages(PAGES, {
      ids: idList ? String(idList).split(',').map((s) => s.trim()).filter(Boolean) : undefined,
      page: values.page ? String(values.page) : pageWord,
      filter: values.filter ? String(values.filter) : undefined,
      queries,
    }).pages.length > 0) {
      console.log(`\nℹ️ Everything selected is excluded from recording. Nothing to do.`);
      process.exit(0);
    }
    console.error(`❌ No matching page found for: ${rawArgs.join(' ') || '(nothing)'}`);
    console.log(`Available page IDs: ${PAGES.map((p) => p.id).join(', ')}`);
    console.log(`Tip: run \`npm run record -- --list\` to view all routes.`);
    process.exit(1);
  }

  if (missingGenerated.length > 0 && !targetPages.some((p) => missingGenerated.includes(p))) {
    if (notYetProduced.length > 0) {
      console.log(
        `\nℹ️ Skipping ${notYetProduced.length} page(s) whose files the CLI pipeline has not produced yet:`,
      );
      console.log(`   ${notYetProduced.map((p) => p.id).join(', ')}`);
      console.log(
        `   Produce them with: npm run capture -- --scaffold && npm run capture -- --distribute`,
      );
    }
    if (ciExcluded.length > 0) {
      console.log(
        `\nℹ️ Skipping ${ciExcluded.length} page(s) that boot their own dev server: CI does not run the CLI pipeline (pass --allow-ci to include them).`,
      );
      console.log(`   ${ciExcluded.map((p) => p.id).join(', ')}`);
    }
  }

  // Pages that boot their own dev server do not touch this repo's frontend or
  // backend, so gating them on those being up would refuse to record a
  // perfectly recordable page — and, worse, tell the operator to start services
  // that have nothing to do with what they asked for.
  if (targetPages.every((p) => p.devServer)) {
    console.log(
      `\nℹ️ Every selected page brings its own dev server; skipping the pre-flight check on ${PROJECT.frontendUrl}.`,
    );
  } else {
    await assertServicesUp(Boolean(values.force));
  }

  console.log(`\n======================================================`);
  console.log(
    `🎬 STARTING AUTOMATED RECORDING FOR ${targetPages.length} PAGE(S)`,
  );
  console.log(`======================================================\n`);

  const engine = new RecordingEngine(ROOT);
  const results: PageResult[] = [];
  const suiteStartTime = Date.now();

  await prewarmDemoRoutes(targetPages);

  for (const pageConfig of targetPages) {
    const pageStartTime = Date.now();
    const res = await engine.recordPage(pageConfig);
    const durationSec = Number(((Date.now() - pageStartTime) / 1000).toFixed(1));

    results.push({
      id: pageConfig.id,
      name: pageConfig.name,
      filename: placeDemoWithCliClips(pageConfig.id, res.filename),
      success: res.success,
      durationSec,
      error: res.error,
      warnings: res.warnings,
      consoleErrors: res.consoleErrors,
    });
  }

  await engine.shutdown();

  const totalDuration = ((Date.now() - suiteStartTime) / 1000).toFixed(1);
  const failedCount = results.filter((r) => !r.success).length;
  const warnedCount = results.filter((r) => r.success && r.warnings.length > 0).length;

  console.log(`\n======================================================`);
  console.log(`📊 RECORDING SUITE SUMMARY (Total: ${totalDuration}s)`);
  console.log(`======================================================`);
  for (const r of results) {
    if (r.success) {
      const badge = r.warnings.length > 0 ? '⚠️  [PASS*]' : '✅ [PASS] ';
      console.log(`   ${badge} (${r.durationSec}s) ${r.name} -> ${r.filename}`);
    } else {
      console.log(
        `   ❌ [FAIL]  (${r.durationSec}s) ${r.name} -> ${r.filename || '(no video)'}`,
      );
      console.log(`        · ${r.error || 'Error captured'}`);
    }
    for (const w of r.warnings) console.log(`        · ${w}`);
  }
  console.log(`======================================================`);
  console.log(
    `   ${results.length - failedCount} passed` +
      (warnedCount > 0 ? ` (${warnedCount} with notes)` : '') +
      `, ${failedCount} failed`,
  );

  const run: RunResults = {
    timestamp: new Date().toISOString(),
    args: rawArgs,
    passed: results.length - failedCount,
    failed: failedCount,
    results,
  };
  mkdirSync(VIDEOS_DIR, { recursive: true });
  writeFileSync(join(VIDEOS_DIR, RESULTS_FILE), JSON.stringify(run, null, 2), 'utf-8');
  console.log(`📁 Video files saved to: ${VIDEOS_DIR}`);
  console.log(`📄 Results: ${join(VIDEOS_DIR, RESULTS_FILE)}\n`);

  // Both paths exit explicitly, and the success path is the one that matters.
  //
  // Returning from `main` leaves the process alive for as long as anything still
  // holds a handle — a dev server's pipe, a Playwright transport — with the work
  // finished, the summary printed and the results file written. It looks exactly
  // like a recorder that froze, and on 2026-09-08 a passing demo sat like that
  // for 24 minutes before anyone looked at the results file and saw it had
  // finished in 153s. `cli-capture.ts` documents the same trap and guards it the
  // same way.
  //
  // Failures never showed this, because `exit(1)` below was already explicit —
  // which is why only *passing* runs appeared to hang.
  process.exit(failedCount > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal recording error:', err);
  process.exit(1);
});
