/**
 * Runs a CLI flow under a real pseudo-terminal and records it.
 *
 * Why a PTY and not `child_process.spawn`: an interactive CLI checks whether it
 * is attached to a terminal. CopilotKit's refuses outright without one rather
 * than opening a browser sign-in it cannot finish — so a plain pipe cannot
 * drive this at all, and an arrow key written to a pipe moves nothing.
 *
 * What this file guarantees, and why each matters:
 *
 * - **Every action is gated on the screen, never on a timer.** Prompt timing
 *   varies by minutes (npx cache misses, sign-in round trips). Timers that are
 *   generous enough to be safe make every run that much slower, and timers that
 *   are not silently type an app name into a menu.
 * - **List rows are found by label.** See `core/cli/flow.ts`.
 * - **Output is captured to a cast as it happens**, so a run that fails halfway
 *   still leaves a watchable, diffable record of how far it got.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { castDuration } from './cast';
import { DEFAULT_SELECTION_MARKERS } from './screen';
import { PtySession, sleep } from './session';
import { KEY_SEQUENCES, type CliFlowConfig, type CliKeyName, type CliStep } from './flow';

export interface CliStepResult {
  label: string;
  status: 'ok' | 'skipped' | 'failed';
  /** How long the step spent waiting for its prompt. */
  waitedMs: number;
  /** For select steps: the row the highlight finished on. */
  landedOn?: string;
  /** For select steps: how many keypresses that took. */
  keypresses?: number;
  error?: string;
}

export interface CliRunResult {
  id: string;
  name: string;
  success: boolean;
  exitCode: number | null;
  durationSec: number;
  /** How long the replay will last, which compression may make shorter. */
  castDurationSec: number;
  castFile: string;
  steps: CliStepResult[];
  /** `expectFiles` entries that did not exist when the run finished. */
  missingFiles: string[];
  error?: string;
  /** Tail of the screen, for diagnosing a failure without opening the cast. */
  tail: string;
}

export interface RunFlowOptions {
  /** Repo root; `cwd` and `expectFiles` resolve against it. */
  rootDir: string;
  /** Where the cast and report are written. */
  outDir: string;
  /** Mirror the child's output to this process's stdout. Default true. */
  echo?: boolean;
}

const DEFAULT_STEP_TIMEOUT_MS = 60_000;
const DEFAULT_RUN_TIMEOUT_MS = 15 * 60_000;

function keysToBytes(keys: CliKeyName[]): string {
  return keys.map((k) => KEY_SEQUENCES[k]).join('');
}

/**
 * Walks a list prompt to the row whose label matches.
 *
 * Stops on the label, not on a count — and reports every label it passed
 * through when it cannot find one, because "expected Mastra, saw: LangGraph
 * (Python), LangGraph (JavaScript), …" is a usable bug report and "select
 * failed" is not.
 */
async function runSelect(
  session: PtySession,
  step: CliStep,
  log: (msg: string) => void,
): Promise<{ landedOn: string; keypresses: number }> {
  const select = step.select!;
  const markers = select.markers ?? DEFAULT_SELECTION_MARKERS;
  const key: CliKeyName = select.key ?? 'Down';
  const max = select.max ?? 60;
  const stepMs = select.stepMs ?? 130;
  const wanted = select.label.toLowerCase();
  const seen: string[] = [];

  for (let presses = 0; presses <= max; presses++) {
    const current = session.readHighlight(markers);

    if (current) {
      if (seen[seen.length - 1] !== current) seen.push(current);
      if (current.toLowerCase().includes(wanted)) {
        log(`      highlight on "${current}" after ${presses} × ${key}`);
        return { landedOn: current, keypresses: presses };
      }
    }

    if (presses === max) break;
    session.send(KEY_SEQUENCES[key]);
    await sleep(stepMs);
  }

  throw new Error(
    `Never reached "${select.label}" in ${max} × ${key}. ` +
      `Rows seen: ${seen.length ? seen.join(' · ') : '(none — no highlighted row ever painted)'}`,
  );
}

async function runStep(
  session: PtySession,
  step: CliStep,
  defaultTimeout: number,
  log: (msg: string) => void,
  abortOn: (string | RegExp)[] = [],
): Promise<CliStepResult> {
  const result: CliStepResult = { label: step.label, status: 'ok', waitedMs: 0 };

  if (step.waitFor) {
    const timeout = step.timeoutMs ?? defaultTimeout;
    const { matched, waitedMs, aborted } = await session.waitFor(step.waitFor, timeout, {
      abortOn,
    });
    result.waitedMs = waitedMs;

    // An abort is the CLI's own error, not this step's. Report what the screen
    // said rather than "the prompt never appeared", which sends the reader off
    // to debug a step that was never reached.
    if (aborted) {
      return {
        ...result,
        status: 'failed',
        error: `The command reported an error while waiting for this step.\nScreen:\n${session.tail(12)}`,
      };
    }

    if (!matched) {
      if (step.optional) {
        log(`   ⏭  ${step.label} — prompt absent, skipped (optional)`);
        return { ...result, status: 'skipped' };
      }
      return {
        ...result,
        status: 'failed',
        error:
          `Waited ${(waitedMs / 1000).toFixed(1)}s for ${String(step.waitFor)} and it never appeared. ` +
          `Last screen:\n${session.tail(8)}`,
      };
    }
    log(`   ✓ ${step.label} — prompt after ${(waitedMs / 1000).toFixed(1)}s`);
  } else {
    log(`   ✓ ${step.label}`);
  }

  try {
    if (step.select) {
      const { landedOn, keypresses } = await runSelect(session, step, log);
      result.landedOn = landedOn;
      result.keypresses = keypresses;
    }

    if (step.type != null) {
      session.send(step.type);
      await sleep(120);
    }

    if (step.keys?.length) {
      session.send(keysToBytes(step.keys));
    }

    if (step.settleMs) await sleep(step.settleMs);

    if (step.expect) {
      const { matched } = await session.waitFor(
        step.expect,
        step.timeoutMs ?? defaultTimeout,
      );
      if (!matched) {
        return {
          ...result,
          status: 'failed',
          error:
            `Acted, but the screen never showed ${String(step.expect)}. ` +
            `Last screen:\n${session.tail(8)}`,
        };
      }
    }
  } catch (e) {
    return {
      ...result,
      status: 'failed',
      error: e instanceof Error ? e.message : String(e),
    };
  }

  return result;
}

/**
 * Runs one flow start to finish.
 *
 * Never throws for a flow that simply failed — a failed run is a result with
 * `success: false`, so the caller can record it in the summary and carry on to
 * the next flow. Only a broken *configuration* throws.
 */
export async function runCliFlow(
  flow: CliFlowConfig,
  opts: RunFlowOptions,
): Promise<CliRunResult> {
  const cwd = join(opts.rootDir, flow.cwd);
  if (!existsSync(cwd)) {
    throw new Error(
      `Flow "${flow.id}" has cwd "${flow.cwd}", which does not exist under ${opts.rootDir}.`,
    );
  }

  const cols = flow.cols ?? 120;
  const rows = flow.rows ?? 32;
  const stepTimeout = flow.stepTimeoutMs ?? DEFAULT_STEP_TIMEOUT_MS;
  const runTimeout = flow.timeoutMs ?? DEFAULT_RUN_TIMEOUT_MS;
  const args = flow.args ?? [];

  const log = (msg: string): void => console.log(msg);
  const commandLine = [flow.command, ...args].join(' ');

  console.log(`\n======================================================`);
  console.log(`⌨️  CLI FLOW: ${flow.name} (${flow.id})`);
  console.log(`   $ ${commandLine}`);
  console.log(`   in ${cwd}`);
  console.log(`======================================================`);

  const startedAt = Date.now();
  const session = new PtySession({
    command: flow.command,
    args,
    cwd,
    env: flow.env,
    cols,
    rows,
    echo: opts.echo ?? true,
    title: flow.name,
    preamble: { prompt: `${cwd}> `, command: commandLine },
  });

  const steps: CliStepResult[] = [];
  let error: string | undefined;
  /** Set when `doneWhen` matched, so the exit code we caused is not judged. */
  let finishedByBanner = false;

  const runDeadline = setTimeout(() => {
    error ??= `Run exceeded ${(runTimeout / 1000).toFixed(0)}s and was killed.`;
    session.kill();
  }, runTimeout);

  try {
    for (const step of flow.steps ?? []) {
      const result = await runStep(session, step, stepTimeout, log, flow.abortOn);
      steps.push(result);

      if (result.status === 'failed') {
        error = `Step "${step.label}": ${result.error}`;
        console.error(`   ✗ ${error}`);
        session.kill();
        break;
      }
    }

    if (!error) {
      if (flow.doneWhen) {
        const { matched } = await session.waitFor(flow.doneWhen, runTimeout, {
          scope: 'stream',
          abortOn: flow.abortOn,
        });
        if (matched) {
          finishedByBanner = true;
          log(`   ✓ Finished — screen reported completion.`);
          session.kill();
        } else {
          error = `Never printed ${String(flow.doneWhen)}, and the command did not finish.`;
          session.kill();
        }
      } else {
        const exited = await session.waitForExit(runTimeout);
        if (!exited) {
          error = `Command never exited after its last answer.`;
          session.kill();
        }
      }
    }
  } finally {
    clearTimeout(runDeadline);
    session.kill();
    // The exit event can land a tick after the last output; without this the
    // recorded exit code is null on runs that in fact finished cleanly.
    await session.waitForExit(2000);
  }

  const expectedCode = flow.expectExitCode ?? 0;
  const exitCode = session.code;
  if (!error && !finishedByBanner && exitCode !== expectedCode) {
    error = `Exited ${exitCode}, expected ${expectedCode}.`;
  }

  const missingFiles = (flow.expectFiles ?? []).filter(
    (rel) => !existsSync(join(opts.rootDir, rel)),
  );
  if (!error && missingFiles.length > 0) {
    error = `Command reported success but produced nothing: missing ${missingFiles.join(', ')}.`;
  }

  const built = session.cast.save(join(opts.outDir, flow.castFile));

  return {
    id: flow.id,
    name: flow.name,
    success: !error,
    exitCode,
    durationSec: Number(((Date.now() - startedAt) / 1000).toFixed(1)),
    castDurationSec: Number(castDuration(built).toFixed(1)),
    castFile: flow.castFile,
    steps,
    missingFiles,
    error,
    tail: session.tail(14),
  };
}
