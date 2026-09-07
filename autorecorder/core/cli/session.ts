/**
 * A live pseudo-terminal session, recording everything it sees.
 *
 * Shared by the two things that run commands: the flow driver, which answers
 * prompts and waits for the command to exit, and the service runner, which
 * starts something long-lived and waits for it to say it is ready. Both need
 * identical screen-reading, so it lives here rather than in either of them.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import pty from 'node-pty';
import { keystrokeDelay } from '../overlays/human';
import { CastRecorder } from './cast';
import { highlightedLabel, lastLines, tailMatches } from './screen';

const POLL_INTERVAL_MS = 60;

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Windows needs the real executable, not the bare name.
 *
 * `npx` on Windows is `npx.cmd`; ConPTY will not resolve it the way a shell
 * would. Resolving here rather than delegating to `cmd /c` keeps arguments
 * exactly as written — no second round of shell quoting to get wrong.
 */
export function resolveExecutable(command: string): string {
  if (process.platform !== 'win32') return command;
  if (/\.(exe|cmd|bat|com)$/i.test(command)) return command;
  if (command.includes('/') || command.includes('\\')) return command;

  const exts = (process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';');
  for (const dir of (process.env.PATH ?? '').split(';')) {
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = join(dir, command + ext);
      if (existsSync(candidate)) return candidate;
    }
  }
  return command;
}

export interface SessionOptions {
  command: string;
  args?: string[];
  cwd: string;
  env?: Record<string, string>;
  cols?: number;
  rows?: number;
  /** Mirror the child's output to this process's stdout. */
  echo?: boolean;
  /** Title recorded in the cast header. */
  title?: string;
  /**
   * Prompt line written into the cast before the child starts, as
   * `{ prompt, command }` — e.g. `C:\repo> ` and `npm install`.
   *
   * Nothing is fabricated: it is the command actually being run. It exists so a
   * replayed session opens on a terminal that looks like someone typed into it,
   * rather than on bare program output. The command is typed character by
   * character in the replay; see `CastRecorder.typedPreamble`.
   */
  preamble?: { prompt: string; command: string };
}

export class PtySession {
  private stream = '';
  /** Where the current step's view starts — reset after every keystroke. */
  private viewStart = 0;
  private exited = false;
  private exitCode: number | null = null;

  readonly cast: CastRecorder;
  private readonly proc: pty.IPty;

  constructor(opts: SessionOptions) {
    const cols = opts.cols ?? 120;
    const rows = opts.rows ?? 32;

    this.cast = new CastRecorder({ width: cols, height: rows, title: opts.title });
    if (opts.preamble) {
      const { prompt, command } = opts.preamble;
      this.cast.typedPreamble(
        prompt,
        command,
        [...command].map((ch) => keystrokeDelay(ch, { charDelayMs: 70 })),
      );
    }

    this.proc = pty.spawn(resolveExecutable(opts.command), opts.args ?? [], {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: opts.cwd,
      env: { ...process.env, ...(opts.env ?? {}) } as Record<string, string>,
    });

    const echo = opts.echo ?? true;
    this.proc.onData((data) => {
      this.stream += data;
      this.cast.output(data);
      if (echo) process.stdout.write(data);
    });
    this.proc.onExit(({ exitCode }) => {
      this.exited = true;
      this.exitCode = exitCode;
    });
  }

  get hasExited(): boolean {
    return this.exited;
  }

  get code(): number | null {
    return this.exitCode;
  }

  /** Output since the last keystroke — i.e. the current screen, not the history. */
  view(): string {
    return this.stream.slice(this.viewStart);
  }

  tail(lines = 12): string {
    return lastLines(this.stream, lines);
  }

  /**
   * Discards everything already on screen.
   *
   * Called after each keystroke so the next wait can only be satisfied by
   * output the keystroke actually produced. Without this, a prompt answered
   * three steps ago still sits in the buffer and instantly satisfies a later
   * wait for the same text.
   */
  resetView(): void {
    this.viewStart = this.stream.length;
  }

  send(data: string): void {
    this.cast.input(data);
    this.proc.write(data);
    this.resetView();
  }

  async waitFor(
    pattern: string | RegExp,
    timeoutMs: number,
    opts: { scope?: 'view' | 'stream'; abortOn?: (string | RegExp)[] } = {},
  ): Promise<{ matched: boolean; waitedMs: number; aborted?: string }> {
    const started = Date.now();
    const read = (): string => (opts.scope === 'stream' ? this.stream : this.view());

    while (Date.now() - started < timeoutMs) {
      if (tailMatches(read(), pattern)) {
        return { matched: true, waitedMs: Date.now() - started };
      }

      // A CLI that has already reported an error will never print the prompt
      // being waited for. Without this the run spends its whole timeout — six
      // minutes, in the case that prompted this — waiting for something the
      // screen already says is not coming, and then blames the wrong step.
      for (const abort of opts.abortOn ?? []) {
        if (tailMatches(read(), abort)) {
          return {
            matched: false,
            waitedMs: Date.now() - started,
            aborted: String(abort),
          };
        }
      }

      // A prompt cannot appear after the process is gone. Give any final output
      // one poll to arrive, then stop waiting rather than burning the timeout.
      if (this.exited) {
        await sleep(POLL_INTERVAL_MS);
        return { matched: tailMatches(read(), pattern), waitedMs: Date.now() - started };
      }
      await sleep(POLL_INTERVAL_MS);
    }
    return { matched: false, waitedMs: Date.now() - started };
  }

  /**
   * The highlighted row, preferring the freshest repaint.
   *
   * Falls back to the wider stream because some prompts repaint only the lines
   * that changed: after an arrow key the new view may hold the marker line
   * alone, or — on a partial repaint — not hold it at all.
   */
  readHighlight(markers: string[]): string | null {
    return highlightedLabel(this.view(), markers) ?? highlightedLabel(this.stream, markers);
  }

  async waitForExit(timeoutMs: number): Promise<boolean> {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (this.exited) return true;
      await sleep(POLL_INTERVAL_MS);
    }
    return false;
  }

  /**
   * Ends the process and everything it started.
   *
   * On Windows this deliberately avoids `IPty.kill()`. node-pty's ConPTY kill
   * path forks a helper (`conpty_console_list_agent`) to enumerate console
   * processes; run under tsx, module resolution finds that helper's TypeScript
   * source rather than its compiled JavaScript, and it dies with
   * "AttachConsole failed" — taking the run with it, after the recording has
   * already succeeded.
   *
   * `taskkill /T` also solves a second problem the ordinary kill has: a dev
   * server is a tree (a package manager script that spawned a bundler that
   * spawned an agent), and killing only the root leaves the port held, so the
   * next package manager's recording finds it occupied and silently films the
   * previous app.
   */
  kill(): void {
    if (this.exited) return;

    if (process.platform === 'win32' && this.proc.pid) {
      try {
        execFileSync('taskkill', ['/pid', String(this.proc.pid), '/T', '/F'], {
          stdio: 'ignore',
        });
        return;
      } catch {
        // Already gone, or taskkill unavailable — fall through to node-pty's
        // own kill rather than leaving the process running.
      }
    }

    try {
      this.proc.kill();
    } catch {
      // Already gone between the check and the call; nothing to clean up.
    }
  }
}
