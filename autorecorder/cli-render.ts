/**
 * Render side of the CLI recorder: turns captured casts into the deliverable
 * videos, and decides per package manager what the third clip is.
 *
 * Runs no commands itself and needs no services. It reads what `npm run
 * capture` already recorded and films it, which is why re-shooting a clip —
 * different pacing, different font size, a doc page that has since changed —
 * costs seconds instead of another scaffold and another sign-in.
 *
 *   npm run capture -- --scaffold     run the CLI, write the cast   (once)
 *   npm run render  -- --cli          film it                       (repeatable)
 *   npm run cli:videos                film everything and record the demos
 *
 * The per-manager set is three clips, and the third depends on how the
 * install went. That is read from the capture report, not chosen by hand:
 *
 *   report.success === true    -> film the install, then record `onSuccess`
 *                                 (the app, live) with `--demos`
 *   report.success === false   -> film the install, then film `onFailure`
 *                                 (the same cast plus the versions, the
 *                                 manifest, and a written explanation)
 */
import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLI_FLOWS, CLI_VIDEOS } from './config/cli.config';
import { PAGES } from './config/pages.config';
import { muxAudio } from './core/cli/audio';
import { refuseInCi } from './core/cli/ci-guard';
import { compressCast, readCast } from './core/cli/cast';
import { type CliRunResult } from './core/cli/driver';
import { buildFindingNote } from './core/cli/finding';
import { type CliFlowConfig, type CliVideoConfig } from './core/cli/flow';
import { RecordingEngine, type CliRecordSegment, type RecordResult } from './core/engine';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(__dirname, '..');
const CAST_DIR = join(__dirname, 'casts');
/** CLI clips live apart from the per-doc-page recordings. */
const VIDEO_SUBDIR = 'cli';
const VIDEO_DIR = join(__dirname, 'videos', VIDEO_SUBDIR);

function flowById(id: string): CliFlowConfig {
  const flow = CLI_FLOWS.find((f) => f.id === id);
  if (!flow) {
    throw new Error(
      `cli.config.ts: video references flow "${id}", which is not a registered flow.`,
    );
  }
  return flow;
}

type Report = Pick<CliRunResult, 'success' | 'exitCode' | 'error' | 'missingFiles' | 'tail' | 'durationSec'>;

/** The capture report for a flow, or null when it has not been captured. */
function reportFor(flow: CliFlowConfig): Report | null {
  const file = join(CAST_DIR, flow.reportFile);
  if (!existsSync(file)) return null;
  try {
    const r = JSON.parse(readFileSync(file, 'utf-8')) as Partial<CliRunResult>;
    return {
      success: r.success !== false,
      exitCode: r.exitCode ?? null,
      error: r.error,
      missingFiles: r.missingFiles ?? [],
      tail: r.tail ?? '',
      durationSec: r.durationSec ?? 0,
    };
  } catch {
    // An unreadable report says nothing about the cast; treat it as absent.
    return null;
  }
}

/** Every clip a video can produce, with its readiness, for the listing. */
function describe(video: CliVideoConfig): string {
  const flows = video.flows.map(flowById);
  const missing = flows.filter((f) => !existsSync(join(CAST_DIR, f.castFile))).map((f) => f.id);
  if (missing.length) return `⬜ needs capture: ${missing.join(', ')}`;
  const failed = flows.filter((f) => reportFor(f)?.success === false).map((f) => f.id);
  if (failed.length) {
    return video.onFailure
      ? `❌ install failed → will also film ${video.onFailure.videoName}`
      : `❌ capture failed (${failed.join(', ')}); no onFailure clip declared`;
  }
  return video.onSuccess
    ? `✅ ready → then record --${video.onSuccess.recordPage}`
    : '✅ ready';
}

function printUsage(): void {
  console.log(`\n🎬 RENDER THE CLI VIDEOS\n`);
  for (const video of CLI_VIDEOS) {
    console.log(`  ${String(video.order).padStart(2, ' ')}. [${video.id}] ${video.name}`);
    console.log(`      npm run render -- --${video.id}`);
    console.log(`      Segments: ${video.flows.join(' → ')}`);
    console.log(`      ${describe(video)}`);
  }
  console.log(`
  npm run render -- --all       every video whose casts are captured, plus the
                                finding clip for every install that failed
  npm run render -- --all --demos
                                …and then record the live demo for every install
                                that succeeded   (= npm run cli:videos)
  npm run render -- --<id> --force
                                film even when the capture is marked failed

  Casts come from:  npm run capture -- --<flow-id>
`);
}

function selectVideos(args: string[]): CliVideoConfig[] {
  if (args.includes('--all')) {
    return CLI_VIDEOS.filter((v) =>
      v.flows.every((id) => existsSync(join(CAST_DIR, flowById(id).castFile))),
    );
  }
  const ids = args
    .filter((a) => a.startsWith('--'))
    .map((a) => a.replace(/^-+/, '').toLowerCase());
  return CLI_VIDEOS.filter(
    (v) => ids.includes(v.id.toLowerCase()) || (v.onFailure && ids.includes(v.onFailure.id.toLowerCase())),
  );
}

async function main(): Promise<void> {
  refuseInCi('npm run render');

  const args = process.argv.slice(2);
  if (
    args.length === 0 ||
    args.includes('--list') ||
    args.includes('--help') ||
    args.includes('-h')
  ) {
    printUsage();
    return;
  }

  const force = args.includes('--force');
  const withDemos = args.includes('--demos');
  const videos = selectVideos(args);
  if (videos.length === 0) {
    console.error(`❌ No CLI video matched: ${args.join(' ')}`);
    console.error(`   Known ids: ${CLI_VIDEOS.map((v) => v.id).join(', ')}`);
    process.exit(1);
  }

  const engine = new RecordingEngine(ROOT);
  const results: (RecordResult & { id: string })[] = [];
  /** Signature -> the video file already filmed for it, for the copy shortcut. */
  const rendered = new Map<string, string>();
  /** Page ids to record afterwards: the demos of installs that succeeded. */
  const demosToRecord: string[] = [];

  const film = async (
    id: string,
    req: Parameters<RecordingEngine['recordCliFlow']>[0],
    audio: string | undefined,
    signature: string,
  ): Promise<void> => {
    // The CLI runs once and its result is copied, so all four sets open on the
    // same create footage. Filming it four times would burn the cast's full
    // duration each time to produce four byte-identical videos; copying the
    // first is the same output in a fraction of the time. Two videos are the
    // same footage only if everything that reaches the screen matches — and a
    // narrated clip is never satisfied by copying a silent one.
    const alreadyRendered = rendered.get(signature);
    if (alreadyRendered) {
      const from = join(VIDEO_DIR, `${alreadyRendered}.webm`);
      const to = join(VIDEO_DIR, `${req.filename}.webm`);
      if (existsSync(from)) {
        copyFileSync(from, to);
        console.log(`\n📄 ${req.name}\n   identical to ${alreadyRendered} — copied rather than re-filmed.`);
        results.push({ id, success: true, filename: `${req.filename}.webm`, warnings: [] });
        return;
      }
    }

    const result = await engine.recordCliFlow(req);
    if (result.success) rendered.set(signature, req.filename);

    // Narration goes on after the picture exists. A mux failure is a warning,
    // not a failed recording: the video is already on disk and watchable, and
    // reporting it as failed would send someone off to re-record footage that
    // is fine.
    if (result.success && audio) {
      try {
        const mux = muxAudio(join(VIDEO_DIR, result.filename), join(__dirname, audio));
        console.log(
          `   🔊 Narration added (${mux.audioSeconds}s over ${mux.videoSeconds}s of video` +
            (mux.paddedSeconds > 0
              ? `; held the last frame for ${mux.paddedSeconds}s so it was not cut off).`
              : ').'),
        );
      } catch (e) {
        const note = e instanceof Error ? e.message : String(e);
        console.warn(`   ⚠️ ${note}`);
        result.warnings.push(note);
      }
    }

    results.push({ ...result, id });
  };

  for (const video of videos) {
    const flows = video.flows.map(flowById);
    const missing = flows.filter((f) => !existsSync(join(CAST_DIR, f.castFile)));
    if (missing.length > 0) {
      console.error(
        `\n❌ ${video.name}: no cast for ${missing.map((f) => f.id).join(', ')}.` +
          `\n   Capture first: ${missing.map((f) => `npm run capture -- --${f.id}`).join('  ')}`,
      );
      results.push({
        id: video.id,
        success: false,
        filename: '',
        error: `Missing casts: ${missing.map((f) => f.id).join(', ')}`,
        warnings: [],
      });
      continue;
    }

    const reports = flows.map((f) => ({ flow: f, report: reportFor(f) }));
    const failed = reports.filter((r) => r.report?.success === false);

    // A failed capture with nothing declared for it must not be filmed and
    // handed over as a finished clip: the video would look complete while
    // showing a command that never did. With `onFailure` declared, the failure
    // IS the deliverable — the install clip shows it happening and the finding
    // clip explains it — so both are filmed.
    if (failed.length > 0 && !video.onFailure && !force) {
      console.error(
        `\n❌ ${video.name}: refusing to film a failed capture.\n` +
          failed.map((f) => `   ${f.flow.id}: ${f.report?.error ?? 'capture failed'}`).join('\n') +
          `\n   Re-capture it, declare onFailure in cli.config.ts, or pass --force.`,
      );
      results.push({
        id: video.id,
        success: false,
        filename: '',
        error: `Capture failed: ${failed.map((f) => f.flow.id).join(', ')}`,
        warnings: [],
      });
      continue;
    }

    const segments: CliRecordSegment[] = flows.map((flow) => ({
      cast: compressCast(readCast(join(CAST_DIR, flow.castFile)), {
        maxGapSec: flow.render?.maxGapSec,
        speed: flow.render?.speed,
      }),
      title: flow.render?.title ?? flow.name,
    }));

    // The install clip, pass or fail.
    await film(
      video.id,
      {
        id: video.id,
        name: video.name,
        filename: video.videoFile,
        segments,
        docUrl: video.docUrl,
        subdir: VIDEO_SUBDIR,
        ideTabs: video.ideTabs,
        ideDwellMs: video.ideDwellMs,
        notepad: video.notepad,
      },
      video.audio,
      JSON.stringify([video.docUrl ?? null, video.flows, video.ideTabs ?? null, video.notepad?.body ?? null, video.audio ?? null]),
    );

    // Then the third clip, decided by the report.
    if (failed.length > 0 && video.onFailure && video.failureVideoFile) {
      const f = video.onFailure;
      const primary = failed[0];
      const body = buildFindingNote(primary.flow, primary.report!, f.analysis);
      // Finding tabs show generated files; only the ones that exist go on
      // screen, and the clip says so rather than failing over a VERSIONS.md
      // an install that died early never wrote.
      const tabs = (f.ideTabs ?? []).filter((t) => existsSync(join(ROOT, t.filePath)));
      const skipped = (f.ideTabs ?? []).length - tabs.length;
      if (skipped > 0) {
        console.warn(`   ⚠️ ${f.name}: ${skipped} IDE tab(s) skipped — file not produced by the failed install.`);
      }
      console.log(`\n📝 ${f.name}: filming the finding for ${primary.flow.id}.`);
      await film(
        f.id,
        {
          id: f.id,
          name: f.name,
          filename: video.failureVideoFile,
          segments,
          docUrl: video.docUrl,
          subdir: VIDEO_SUBDIR,
          ideTabs: tabs.length ? tabs : undefined,
          ideDwellMs: f.ideDwellMs,
          notepad: { filename: f.notepadFile ?? `${f.id}.txt`, body, charDelayMs: f.charDelayMs },
        },
        f.audio,
        JSON.stringify(['finding', video.docUrl ?? null, video.flows, tabs, body, f.audio ?? null]),
      );
    } else if (failed.length === 0 && video.onSuccess) {
      if (!PAGES.some((p) => p.id === video.onSuccess!.recordPage)) {
        console.warn(`   ⚠️ ${video.name}: onSuccess names page "${video.onSuccess.recordPage}", which is not in pages.config.ts.`);
      } else {
        demosToRecord.push(video.onSuccess.recordPage);
      }
    }
  }

  console.log(`\n======================================================`);
  console.log(`📊 CLI RENDER SUMMARY`);
  console.log(`======================================================`);
  for (const r of results) {
    console.log(
      `   ${r.success ? '✅ [PASS] ' : '❌ [FAIL] '} ${r.id} -> ${r.filename || '(no video)'}`,
    );
    if (r.error) console.log(`        · ${r.error}`);
    for (const w of r.warnings) console.log(`        · ${w}`);
  }
  console.log(`======================================================\n`);

  let demoExit = 0;
  if (demosToRecord.length > 0) {
    if (withDemos) {
      // Video 3 for the installs that worked: a page recording of the app,
      // driven by cli.ts so it is the same take as any other page. One child
      // process for all of them, so the summary and RECORD_RESULTS.json cover
      // the whole set.
      console.log(`🎬 Recording the live demo for: ${demosToRecord.join(', ')}\n`);
      const child = spawnSync(
        process.execPath,
        [join(__dirname, 'node_modules', 'tsx', 'dist', 'cli.mjs'), join(__dirname, 'cli.ts'), `--pages=${demosToRecord.join(',')}`],
        { stdio: 'inherit', cwd: __dirname },
      );
      demoExit = child.status ?? 1;
    } else {
      console.log(`ℹ️ Installs that succeeded have a live demo to record:`);
      console.log(`   npm run record -- --pages=${demosToRecord.join(',')}`);
      console.log(`   (or npm run render -- --all --demos to do both in one go)\n`);
    }
  }

  if (results.some((r) => !r.success) || demoExit !== 0) process.exit(1);
}

main().catch((err) => {
  console.error('Fatal render error:', err);
  process.exit(1);
});
