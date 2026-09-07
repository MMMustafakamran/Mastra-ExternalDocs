/**
 * Starts a long-running command — a dev server — and captures its boot.
 *
 * Different from `driver.ts` in the one way that matters: a dev server never
 * exits, so "the command finished" is not the success condition. It is ready
 * when it says it is, and then it has to *stay up*, because the demo recorded
 * immediately afterwards is served by it.
 *
 * That is why this exists at all rather than the operator starting a server by
 * hand: the terminal segment in a demo video is then genuinely the boot of the
 * process serving the app in the next segment, not a re-enactment of one.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { type Cast } from './cast';
import { PtySession, sleep } from './session';

export interface ServiceDefinition {
  /** Working directory, relative to the repo root. */
  cwd: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;

  /**
   * Output that means "serving".
   *
   * Next prints `Ready in 1234ms`; other stacks differ, which is why this is
   * configuration and not a constant. Waiting for a fixed number of seconds
   * instead would either cut the boot off mid-compile or pad every recording.
   */
  readyPattern: string | RegExp;

  /** How long to wait for `readyPattern`. Cold Next compiles are slow. */
  readyTimeoutMs?: number;

  /**
   * Extra capture after ready, so the cast ends on a settled server rather than
   * mid-line.
   */
  settleMs?: number;

  /**
   * URL to request once the server says it is ready, before this function
   * returns.
   *
   * "Ready" and "able to answer" are not the same thing for a dev server. A
   * bundler compiles a route when the first request for it arrives, so the whole
   * cold compile of a fresh scaffold lands on whoever asks first — and that is
   * the recorder's demo navigation, which has a fixed budget measured in
   * seconds. Warming here moves that compile into the boot window instead, which
   * is minutes long and is footage anyway: the terminal segment then shows the
   * compile actually happening, and the browser afterwards opens a page that is
   * already built.
   *
   * Failures are ignored on purpose. This is an optimisation, not a health
   * check; the demo step is what decides whether the app works.
   */
  warmUrl?: string;

  /** How long to allow the warm request. */
  warmTimeoutMs?: number;

  /**
   * Output that means the boot has failed, however much else it printed.
   *
   * `readyPattern` is matched against the whole stream, and a `next dev` that
   * died on EADDRINUSE still prints enough around the error for "Ready in" to
   * match — the recorder then reported `Ready in 3.6s` and filmed whatever was
   * already on that port. Anything here is checked first. Defaults to the
   * usual port-clash and fatal-error wordings; pass `[]` to disable.
   */
  abortOn?: (string | RegExp)[];

  /**
   * Port this server will listen on, checked free before it is spawned.
   *
   * A foreign process already there — a sibling repo's scaffold left running,
   * the repo's own frontend — would otherwise become the subject of the
   * recording while the real server died quietly. The engine fills this in
   * from `originUrl`; set it only when the two differ.
   */
  port?: number;

  cols?: number;
  rows?: number;
}

const DEFAULT_ABORT_ON: (string | RegExp)[] = [
  /EADDRINUSE/i,
  /address already in use/i,
  /port \d+ is (already )?in use/i,
  /Error: Cannot find module/i,
];

/**
 * Is something already answering on this port?
 *
 * Resolves true when a TCP connect succeeds; false on refusal or timeout. A
 * refusal is the normal state of a free port, not an error.
 */
export async function isPortInUse(port: number, host = '127.0.0.1'): Promise<boolean> {
  const { connect } = await import('node:net');
  return new Promise((resolve) => {
    const socket = connect({ port, host });
    const done = (busy: boolean): void => {
      socket.destroy();
      resolve(busy);
    };
    socket.setTimeout(800, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

export interface RunningService {
  /** The boot, captured up to the moment it was ready. */
  cast: Cast;
  /** Seconds from spawn to the ready line — a real datum for the matrix. */
  bootSeconds: number;
  /** Last lines of output, for diagnostics. */
  tail: string;
  /** Kills the process. Always call this, including on failure paths. */
  stop: () => Promise<void>;
}

export class ServiceStartError extends Error {
  constructor(
    message: string,
    readonly tail: string,
  ) {
    super(message);
    this.name = 'ServiceStartError';
  }
}

export async function startService(
  def: ServiceDefinition,
  opts: { rootDir: string; echo?: boolean; title?: string },
): Promise<RunningService> {
  const cwd = join(opts.rootDir, def.cwd);
  if (!existsSync(cwd)) {
    throw new ServiceStartError(
      `Dev server directory ${def.cwd} does not exist — has the scaffold been distributed and installed?`,
      '',
    );
  }

  if (def.port && (await isPortInUse(def.port))) {
    throw new ServiceStartError(
      `Port ${def.port} is already in use, so this server could not have been the one recorded. ` +
        `Stop whatever holds it (a sibling repo's dev server, usually) and re-run.`,
      '',
    );
  }

  const commandLine = [def.command, ...(def.args ?? [])].join(' ');
  console.log(`\n🌐 Starting dev server: ${commandLine}`);
  console.log(`   in ${cwd}`);

  const startedAt = Date.now();
  const session = new PtySession({
    command: def.command,
    args: def.args,
    cwd,
    env: def.env,
    cols: def.cols ?? 120,
    rows: def.rows ?? 32,
    echo: opts.echo ?? true,
    title: opts.title ?? commandLine,
    preamble: { prompt: `${cwd}> `, command: commandLine },
  });

  const stop = async (): Promise<void> => {
    session.kill();
    await session.waitForExit(3000);
  };

  const { matched, aborted } = await session.waitFor(
    def.readyPattern,
    def.readyTimeoutMs ?? 180_000,
    // Scan the whole stream: a fast server can print its ready line before this
    // wait is even entered, and a view-scoped match would miss it and then hang
    // for the full timeout on a server that started perfectly.
    { scope: 'stream', abortOn: def.abortOn ?? DEFAULT_ABORT_ON },
  );

  if (!matched) {
    const tail = session.tail(14);
    await stop();
    throw new ServiceStartError(
      aborted
        ? `Dev server reported an error while booting (matched ${aborted}).`
        : session.hasExited
          ? `Dev server exited (code ${session.code}) before it was ready.`
          : `Dev server never printed ${String(def.readyPattern)} within ${((def.readyTimeoutMs ?? 180_000) / 1000).toFixed(0)}s.`,
      tail,
    );
  }

  if (def.warmUrl) {
    const warmTimeout = def.warmTimeoutMs ?? 180_000;
    const warmStarted = Date.now();
    console.log(`   🔥 Warming ${def.warmUrl} so the first compile is not the demo's...`);
    try {
      const res = await fetch(def.warmUrl, {
        signal: AbortSignal.timeout(warmTimeout),
        redirect: 'follow',
      });
      const warmSeconds = ((Date.now() - warmStarted) / 1000).toFixed(1);
      console.log(`   🔥 ${res.status} in ${warmSeconds}s`);
    } catch (e) {
      // Not fatal: an app that cannot answer here will fail the demo step a few
      // seconds later, with a diagnostic aimed at the page rather than at this.
      console.warn(`   ⚠️ Warm request failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  await sleep(def.settleMs ?? 1200);

  const bootSeconds = Number(((Date.now() - startedAt) / 1000).toFixed(1));
  console.log(`   ✅ Ready in ${bootSeconds}s`);

  return {
    // Built here, not on stop: the cast should show the boot, not the boot plus
    // however long the demo afterwards happened to take.
    cast: session.cast.build(),
    bootSeconds,
    tail: session.tail(14),
    stop,
  };
}
