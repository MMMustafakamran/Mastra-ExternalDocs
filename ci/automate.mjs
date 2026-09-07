/**
 * The pipeline entry point, used identically by a developer and by CI.
 *
 * Everything runs inside this one Node process on purpose. Each `run:` step in
 * a GitHub Actions job is its own subshell, so a server started with `&` in one
 * step is reaped before the next step begins. Spawning both servers here keeps
 * them alive for as long as the recorder needs them.
 *
 * Flags:
 *   --pull               git pull before running
 *   --use-lockfile       install the committed lockfiles instead of re-resolving
 *   --skip-install       skip dependency installation entirely
 *   --ignore-doc-drift   record even if the live docs have moved (alias: --force)
 *   --skip-doc-drift     do not contact the docs site at all (the workflow's
 *                        prepare job already decided; a docs blip must not
 *                        fail a shard)
 *   --allow-port-reuse   record against servers that are already running
 *   --skip-credential-check  bypass the model-credential preflight
 *   --skip-license-check     bypass the threads license-expiry preflight
 *
 * Anything else is forwarded to the recorder (e.g. --shard=1/3, --pages=a,b).
 */
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { checkAllDocDrift } from './check-doc-drift.mjs';
import {
  BACKEND_DIR,
  BACKEND_HEALTH_URL,
  FRONTEND_DIR,
  FRONTEND_URL,
  LOGS_DIR,
  RECORDER_DIR,
  ROOT_DIR,
  VIDEOS_DIR,
  isWindows,
} from './lib/config.mjs';
import { loadEnvFiles, trimInheritedCredentials } from './lib/env.mjs';
import {
  assertModelCredentials,
  assertPortsFree,
  assertThreadsLicenseFresh,
  warmFrontendRoutes,
} from './lib/preflight.mjs';
import { muxAudioFiles } from './lib/mux.mjs';
import { generateReport } from './lib/report.mjs';
import { writeVersionsFile } from './write-versions.mjs';

const OWN_FLAGS = [
  '--pull',
  '--use-lockfile',
  '--skip-install',
  '--ignore-doc-drift',
  '--skip-doc-drift',
  '--force',
  '--allow-port-reuse',
  '--skip-credential-check',
  '--skip-license-check',
];

/**
 * How the frontend, agent and recorder are installed.
 *
 * By default the lockfile is dropped first, so npm resolves the newest versions
 * the ranges in package.json already allow. That is the point of these
 * recordings: they document CopilotKit, so they should be made against the
 * CopilotKit that shipped, not one pinned months ago. It is also exactly what
 * `rm -rf node_modules package-lock.json && npm install` does by hand, which is
 * how these demos have always been checked. Nothing needs deleting alongside
 * it — CI starts on a clean runner, so the lockfile is the only thing pinning
 * anything, and a caret range still cannot cross a major boundary.
 *
 * `--use-lockfile` opts back into the committed versions, for reproducing an
 * older run or bisecting a break to the dependency tree rather than the demo.
 *
 * What no run does is rewrite the ranges. `ncu -u --peer` used to run here and
 * caused most of the sibling Angular pipelines' failures: it bumped every
 * @angular/* package past a lockfile that still pinned the old ones, and the
 * exact inter-package peers made that unsatisfiable. Bumping the manifest is a
 * reviewed change to package.json, not something a nightly run does to itself.
 */
const NPM_INSTALL = 'npm install';

function installNodeDeps(dir, description) {
  if (shouldRefresh) {
    const lockPath = path.join(dir, 'package-lock.json');
    if (fs.existsSync(lockPath)) {
      fs.rmSync(lockPath);
      console.log(`   ↻ ${description}: dropped package-lock.json to resolve the ranges afresh (--use-lockfile keeps it)`);
    }
  }
  runSync(NPM_INSTALL, dir, description);
}

const args = process.argv.slice(2);
const shouldPull = args.includes('--pull');
const shouldRefresh = !args.includes('--use-lockfile');
const skipInstall = args.includes('--skip-install');
const ignoreDocDrift = args.includes('--ignore-doc-drift') || args.includes('--force');
const skipDocDrift = args.includes('--skip-doc-drift');
const allowPortReuse = args.includes('--allow-port-reuse');
const skipCredentialCheck = args.includes('--skip-credential-check');
const skipLicenseCheck = args.includes('--skip-license-check');
// `--force` also means "record anyway" to the recorder, so it is forwarded.
const forwardArgs = args.filter((a) => !OWN_FLAGS.includes(a) || a === '--force');

console.log('═══════════════════════════════════════════════════════════════');
console.log('  🚀 CopilotKit Automation Pipeline');
console.log('═══════════════════════════════════════════════════════════════');

let backendProc = null;
let frontendProc = null;
let logHandles = [];

function killTree(proc, signal = 'SIGTERM') {
  if (!proc || !proc.pid) return;
  try {
    if (isWindows) {
      execSync(`taskkill /pid ${proc.pid} /T /F 2>nul || exit 0`, { stdio: 'ignore' });
    } else {
      try {
        process.kill(-proc.pid, signal);
      } catch {
        proc.kill(signal);
      }
    }
  } catch {
    try {
      proc.kill(signal);
    } catch {
      // ignore
    }
  }
}

function cleanup() {
  if (backendProc || frontendProc) {
    console.log('\n🧹 Cleaning up running processes...');
  }
  if (backendProc) {
    killTree(backendProc);
    backendProc = null;
  }
  if (frontendProc) {
    killTree(frontendProc);
    frontendProc = null;
  }
  for (const fd of logHandles) {
    try {
      fs.closeSync(fd);
    } catch {
      // ignore
    }
  }
  logHandles = [];
}

process.on('SIGINT', () => {
  cleanup();
  process.exit(130);
});
process.on('SIGTERM', () => {
  cleanup();
  process.exit(143);
});
process.on('exit', cleanup);

function runSync(command, cwd, description) {
  console.log(`\n▶ [Step] ${description}...`);
  try {
    execSync(command, { cwd, stdio: 'inherit', shell: true });
  } catch (err) {
    console.error(`❌ Failed during: ${description}`);
    throw err;
  }
}

/**
 * Start a server with its output going to a file.
 *
 * Piping a server's stdio through Node deadlocks once the OS pipe buffer fills,
 * but discarding it entirely (the previous behaviour) means a server that dies
 * mid-run leaves no trace at all. A file gets both: no buffer to fill, and a
 * log to attach to the run artifacts.
 */
function spawnServer(command, cwd, logName) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
  const logPath = path.join(LOGS_DIR, logName);
  const fd = fs.openSync(logPath, 'w');
  logHandles.push(fd);

  const proc = spawn(command, {
    cwd,
    stdio: ['ignore', fd, fd],
    shell: true,
    detached: !isWindows,
  });
  return { proc, logPath };
}

function tailLog(logPath, lines = 25) {
  try {
    const content = fs.readFileSync(logPath, 'utf8').trimEnd().split(/\r?\n/);
    return content.slice(-lines).join('\n');
  } catch {
    return '(no log captured)';
  }
}

async function waitForHealth(url, name, logPath, timeoutMs = 45000) {
  const start = Date.now();
  process.stdout.write(`⏳ Waiting for ${name} (${url})... `);
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (res.ok || res.status < 500) {
        const elapsed = ((Date.now() - start) / 1000).toFixed(1);
        process.stdout.write(`✅ READY (${elapsed}s)!\n`);
        return { ok: true, elapsedSec: Number(elapsed) };
      }
    } catch {
      // keep polling
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
    process.stdout.write('.');
  }
  process.stdout.write('❌ TIMEOUT\n');
  console.error(`\n──── last lines of ${path.basename(logPath)} ────`);
  console.error(tailLog(logPath));
  console.error('────────────────────────────────────────────\n');
  throw new Error(`Timeout waiting for ${name} at ${url}. See ${logPath}`);
}

async function main() {
  const reportData = {
    success: false,
    driftResult: null,
    health: {},
    error: null,
    args: forwardArgs,
    refreshed: shouldRefresh,
  };

  try {
    // 0. Live doc drift
    if (skipDocDrift) {
      console.log('▶ [Step 0] Doc drift check skipped (--skip-doc-drift); the workflow gate already ran it.\n');
    } else {
      console.log('▶ [Step 0] Checking for live documentation drift against doc-snapshot...');
      reportData.driftResult = await checkAllDocDrift();
    }
    const driftResult = reportData.driftResult;

    if (driftResult?.drifted) {
      console.log('\n🚨 [DOC DRIFT DETECTED] Upstream documentation has changed on these pages:');
      console.log('───────────────────────────────────────────────────────────────────────────');
      for (const p of driftResult.driftedPages) {
        console.log(` • [${p.severity}] ${p.docPath}`);
        if (p.oldHash && p.newHash) {
          console.log(`   Hash: ${p.oldHash} ➔ ${p.newHash} (${p.file})`);
        }
      }
      console.log('───────────────────────────────────────────────────────────────────────────');

      if (!ignoreDocDrift) {
        console.log('⚠️ Halting so you can review the doc changes first.');
        console.log('👉 Review in browser: http://localhost:3000/doc-sync');
        console.log('👉 To run anyway, pass `--ignore-doc-drift` or `--force`.');
        generateReport(reportData);
        process.exit(2);
      }
      console.log('⚠️ --ignore-doc-drift provided. Proceeding anyway...\n');
    } else if (driftResult) {
      console.log(`✅ [Doc Drift Check]: All ${driftResult.total} doc pages match the local snapshot.\n`);
    }

    // 1. Preflight — fail before spending time on installs and recordings.
    const envFiles = loadEnvFiles();
    if (envFiles.length > 0) {
      console.log(`🔑 [Preflight] Loaded environment from: ${envFiles.join(', ')}`);
    }
    // Outside the block above on purpose: in CI no .env file loads, and CI is
    // exactly where a secret pasted with a trailing newline comes from.
    const trimmedVars = trimInheritedCredentials();
    if (trimmedVars.length > 0) {
      console.log(
        `🔑 [Preflight] Trimmed surrounding whitespace from: ${trimmedVars.join(', ')}` +
          ' — worth fixing at the source, a stored secret is keeping a stray newline.',
      );
    }
    // `busy` records which ports were already served. With --allow-port-reuse
    // those servers are reused as-is; starting a second one on the same port is
    // precisely the failure this guard exists to prevent.
    const busy = assertPortsFree({ allowReuse: allowPortReuse });
    if (!skipCredentialCheck) {
      await assertModelCredentials();
    }
    if (!skipLicenseCheck) {
      assertThreadsLicenseFresh();
    }

    // 2. Git pull
    if (shouldPull) {
      runSync('git pull', ROOT_DIR, 'Updating repository (git pull)');
    }

    // 3. Dependencies
    if (!skipInstall) {
      runSync(
        shouldRefresh ? 'uv sync --upgrade' : 'uv sync --prerelease=allow',
        BACKEND_DIR,
        'Syncing Backend Dependencies (uv sync)',
      );


      installNodeDeps(FRONTEND_DIR, 'Installing Frontend Dependencies');
      installNodeDeps(RECORDER_DIR, 'Installing Autorecorder Dependencies');

      // Written here, after the installs and before anything is recorded, so
      // the file the Quickstart clip puts on screen names the versions this
      // run actually resolved rather than the ranges package.json declares.
      console.log(`  📌 ${writeVersionsFile()}`);
    }

    // 4. Servers — skipped for any port already being served.
    let backendLog = path.join(LOGS_DIR, 'backend.log');
    if (busy.backend) {
      console.log('\n▶ [Step] Backend already running; reusing it.');
    } else {
      console.log('\n▶ [Step] Starting Backend Server...');
      const backend = spawnServer('uv run --prerelease=allow main.py', BACKEND_DIR, 'backend.log');
      backendProc = backend.proc;
      backendLog = backend.logPath;
    }

    let frontendLog = path.join(LOGS_DIR, 'frontend.log');
    if (busy.frontend) {
      console.log('▶ [Step] Frontend already running; reusing it.');
    } else {
      console.log('▶ [Step] Starting Frontend Server...');
      const frontend = spawnServer('npm run dev', FRONTEND_DIR, 'frontend.log');
      frontendProc = frontend.proc;
      frontendLog = frontend.logPath;
    }

    // 5. Health
    reportData.health.backend = (
      await waitForHealth(BACKEND_HEALTH_URL, 'Backend Agent', backendLog, 45000)
    ).elapsedSec;
    reportData.health.frontend = (
      await waitForHealth(FRONTEND_URL, 'Frontend Next.js App', frontendLog, 60000)
    ).elapsedSec;

    // 6. Warm routes so the recorder's own preflight is not racing a cold build.
    await warmFrontendRoutes();

    // 7. Record
    //
    // The recorder writes videos/RECORD_RESULTS.json and the report reads it.
    // Drop any earlier one first, so a run that dies before recording cannot
    // report yesterday's results as today's.
    fs.rmSync(path.join(VIDEOS_DIR, 'RECORD_RESULTS.json'), { force: true });
    console.log('\n▶ [Step] Running Autorecorder...');
    const recorderCmd =
      forwardArgs.length > 0 ? `npm run record -- ${forwardArgs.join(' ')}` : 'npm run record';
    runSync(recorderCmd, RECORDER_DIR, 'Executing Autorecorder');

    reportData.success = true;
    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('  🎉 Automation completed successfully! All videos recorded.');
    console.log('═══════════════════════════════════════════════════════════════\n');
  } catch (err) {
    reportData.error = err.message || String(err);
    console.error('\n❌ Automation failed:', err.message || err);
    process.exitCode = 1;
  } finally {
    // Only mux when the recorder actually produced videos this run.
    //
    // In `finally` unconditionally, this re-muxed whatever `.webm` files were
    // already on disk from an earlier run — including after a preflight refusal
    // that recorded nothing at all. Harmless-looking, and it was not: before
    // `-af apad` was added below, each pass truncated the stale clip to the
    // voiceover's length, so a run that never started a browser could still
    // shorten yesterday's video. It also prints "✅ Added audio to ..." after
    // "❌ Automation failed", which reads like something was salvaged.
    if (reportData.success) {
      muxAudioFiles();
    } else {
      console.log('\nℹ️ [Audio Mux] Skipped — no recording completed this run.');
    }
    generateReport(reportData);
    cleanup();
  }
}

main();
