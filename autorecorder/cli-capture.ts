/**
 * Capture side of the CLI recorder: runs terminal flows and writes casts.
 *
 * Separate entrypoint from `cli.ts` (which records browser video) because the
 * two halves have different failure modes and different costs. Capturing runs a
 * real, side-effecting command — it scaffolds directories, installs packages,
 * and may need a human at a browser. Rendering a captured cast to video is
 * cheap, offline and repeatable. Keeping them apart means a cosmetic re-render
 * never re-runs `npm install`.
 *
 * Nothing runs without being named. There is no "capture everything" default,
 * because the default would scaffold a project and install four dependency
 * trees on someone who typed the command to see what it did.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLI_DISTRIBUTION, CLI_FLOWS } from './config/cli.config';
import { distribute } from './core/cli/distribute';
import { refuseInCi } from './core/cli/ci-guard';
import { runCliFlow, type CliRunResult } from './core/cli/driver';
import { hasInstalledTree, writeVersionsFile } from './core/cli/versions';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(__dirname, '..');
const OUT_DIR = join(__dirname, 'casts');

/**
 * Exits explicitly rather than letting the process end on its own.
 *
 * node-pty leaves a handle open after the child is gone, so returning from
 * `main` hangs the process indefinitely with the work already finished and the
 * summary already printed — which looks exactly like a recorder that froze
 * mid-run. Every exit path here goes through this.
 */
function finish(code: number): never {
  process.exit(code);
}

function printList(): void {
  console.log(`\n⌨️  REGISTERED CLI FLOWS (${CLI_FLOWS.length} total):\n`);
  for (const flow of CLI_FLOWS) {
    const manual = flow.manual ? '  [manual — excluded from --all]' : '';
    console.log(`  ${String(flow.order).padStart(2, ' ')}. [${flow.id}] ${flow.name}${manual}`);
    console.log(`      Command: npm run capture -- --${flow.id}`);
    console.log(`      Runs:    ${[flow.command, ...(flow.args ?? [])].join(' ')}  (in ${flow.cwd})`);
    console.log(`      Cast:    casts/${flow.castFile}`);
  }
  console.log(`
  npm run capture -- --all         every non-manual flow, in order
  npm run capture -- --login       sign in first; do this once before --scaffold
  npm run capture -- --distribute  copy the scaffold into the four package-manager
                                   directories and seed the model key into each
                                   (add --force to replace directories that exist)
  npm run capture -- --versions    regenerate VERSIONS.md from installed trees
                                   (done automatically after each install)

  Then film everything:   npm run cli:videos
    1. one CLI video (the scaffold, shared by every package manager)
    2. one install video per package manager, pass or fail
    3. per package manager: the finding clip if its install failed,
       or the live demo of the scaffolded app if it succeeded
`);
}

function selectFlows(args: string[]): typeof CLI_FLOWS {
  if (args.includes('--all')) return CLI_FLOWS.filter((f) => !f.manual);

  const ids = args
    .filter((a) => a.startsWith('--'))
    .map((a) => a.replace(/^-+/, '').toLowerCase());

  return CLI_FLOWS.filter((f) => ids.includes(f.id.toLowerCase()));
}

async function main(): Promise<void> {
  // Before any work, so nothing is half-done when it refuses.
  refuseInCi('npm run capture');

  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--list') || args.includes('--help') || args.includes('-h')) {
    printList();
    finish(0);
  }

  mkdirSync(OUT_DIR, { recursive: true });

  // Regenerating versions on their own, for a tree installed outside this
  // pipeline — or when an install succeeded and the demo is being re-recorded
  // later against the same tree.
  if (args.includes('--versions')) {
    let wrote = 0;
    for (const flow of CLI_FLOWS) {
      if (!flow.versionsFor) continue;
      if (!hasInstalledTree(ROOT, flow.versionsFor)) {
        console.log(`   ⏭  ${flow.versionsFor}: nothing installed, skipped`);
        continue;
      }
      const versions = writeVersionsFile(ROOT, flow.versionsFor, { label: flow.name });
      if (versions) {
        wrote++;
        console.log(
          `   ✓ ${flow.versionsFor}/VERSIONS.md — ${Object.keys(versions.resolved).length} packages`,
        );
      }
    }
    console.log(`\n   ${wrote} VERSIONS.md file(s) written.\n`);
    finish(wrote > 0 ? 0 : 1);
  }

  if (args.includes('--distribute')) {
    try {
      const results = distribute(CLI_DISTRIBUTION, {
        rootDir: ROOT,
        force: args.includes('--force'),
      });
      const failed = results.filter((r) => r.status === 'failed');
      const skipped = results.filter((r) => r.status === 'skipped');
      const copied = results.filter((r) => r.status === 'copied');
      const noKey = results.filter((r) => r.status === 'copied' && r.missingEnv.length > 0);

      console.log(
        `\n   ${copied.length} copied, ${skipped.length} skipped, ${failed.length} failed`,
      );
      if (noKey.length) {
        console.warn(
          `   ⚠️ ${noKey.length} target(s) have no model key — their agents will not answer.`,
        );
      }
      if (skipped.length) {
        console.log(`   Pass --force to replace directories that already exist.\n`);
      } else {
        console.log('');
      }
      finish(failed.length > 0 ? 1 : 0);
    } catch (e) {
      console.error(`\n❌ ${e instanceof Error ? e.message : String(e)}\n`);
      finish(1);
    }
  }

  const flows = selectFlows(args);
  if (flows.length === 0) {
    console.error(`❌ No CLI flow matched: ${args.join(' ')}`);
    console.error(`   Known ids: ${CLI_FLOWS.map((f) => f.id).join(', ')}`);
    finish(1);
  }

  const results: CliRunResult[] = [];
  for (const flow of flows) {
    try {
      const result = await runCliFlow(flow, { rootDir: ROOT, outDir: OUT_DIR, echo: true });
      writeFileSync(
        join(OUT_DIR, flow.reportFile),
        JSON.stringify(result, null, 2),
        'utf-8',
      );

      // Resolved versions are readable only once something is installed, and
      // the demo puts them on screen. Writing them here, immediately after the
      // install that produced them, is what keeps the file and the tree it
      // describes from drifting apart.
      if (result.success && flow.versionsFor) {
        const versions = writeVersionsFile(ROOT, flow.versionsFor, { label: flow.name });
        if (versions) {
          console.log(
            `   📋 VERSIONS.md written: ${Object.keys(versions.resolved).length} packages resolved` +
              (versions.unresolved.length
                ? `, ${versions.unresolved.length} declared but not installed`
                : ''),
          );
        }
      }

      results.push(result);
    } catch (e) {
      // A throw from the driver means the flow could not start at all — a
      // missing working directory, usually, because an earlier step in the
      // pipeline has not run yet. Record it and keep going: one unrunnable
      // flow should not hide the results of the others.
      const message = e instanceof Error ? e.message : String(e);
      console.error(`\n❌ ${flow.name} could not start: ${message}`);
      results.push({
        id: flow.id,
        name: flow.name,
        success: false,
        exitCode: null,
        durationSec: 0,
        castDurationSec: 0,
        castFile: flow.castFile,
        steps: [],
        missingFiles: [],
        error: message,
        tail: '',
      });
    }
  }

  console.log(`\n======================================================`);
  console.log(`📊 CLI CAPTURE SUMMARY`);
  console.log(`======================================================`);
  for (const r of results) {
    const badge = r.success ? '✅ [PASS] ' : '❌ [FAIL] ';
    console.log(`   ${badge} (${r.durationSec}s) ${r.name} -> casts/${r.castFile}`);
    for (const step of r.steps) {
      if (step.status === 'skipped') {
        console.log(`        · ${step.label}: skipped (prompt absent)`);
      } else if (step.landedOn) {
        console.log(
          `        · ${step.label}: "${step.landedOn}" after ${step.keypresses} keypresses`,
        );
      }
    }
    if (!r.success) {
      console.log(`        · ${r.error}`);
      if (r.tail) {
        console.log(`        · last screen:`);
        for (const line of r.tail.split(String.fromCharCode(10))) {
          console.log(`            ${line}`);
        }
      }
    }
  }
  console.log(`======================================================`);
  const failed = results.filter((r) => !r.success).length;
  console.log(`   ${results.length - failed} passed, ${failed} failed`);
  console.log(`📁 Casts and reports: ${OUT_DIR}\n`);

  finish(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal capture error:', err);
  finish(1);
});
