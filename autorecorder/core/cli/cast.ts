/**
 * asciinema v2 cast files — the recorder's intermediate format for terminals.
 *
 * Why an intermediate format at all, rather than filming a live terminal:
 *
 * A CLI run is the least reproducible thing this suite touches. It hits the
 * network, it may block on browser sign-in, and it takes minutes. Filming it
 * live means any cosmetic defect in the video -- wrong font size, wrong pacing,
 * a cropped window -- costs another full run to fix.
 *
 * Capturing to a cast splits those concerns. The run happens once and produces
 * a text file; the video is rendered from that file as many times as needed,
 * offline and deterministically. The same file is also the QA artifact: it is
 * diffable, so a CLI that changes its prompts under `@latest` shows up as a
 * diff rather than as a mysteriously broken driver.
 *
 * Format (https://docs.asciinema.org/manual/asciicast/v2/): a JSON header line
 * followed by one JSON array per event, `[elapsedSeconds, code, data]`, where
 * code is "o" for terminal output and "i" for input.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export type CastEventCode = 'o' | 'i';

/** `[elapsedSeconds, code, data]` — elapsed is relative to the header timestamp. */
export type CastEvent = [number, CastEventCode, string];

export interface CastHeader {
  version: 2;
  width: number;
  height: number;
  /** Unix seconds when recording started. */
  timestamp: number;
  /** Total duration; written on close so a truncated file is detectable. */
  duration?: number;
  title?: string;
  env?: Record<string, string>;
}

export interface Cast {
  header: CastHeader;
  events: CastEvent[];
}

/**
 * Accumulates events in memory during a run.
 *
 * In memory rather than streaming to disk because a cast for even a long CLI
 * session is a few hundred KB, and holding it lets a failed run be discarded
 * whole instead of leaving a half-written file that looks like a real recording.
 */
export class CastRecorder {
  private readonly events: CastEvent[] = [];
  private readonly startedAt: number;
  private readonly header: CastHeader;
  /** Seconds of synthetic lead-in (the typed prompt line) before real time. */
  private offset = 0;

  constructor(opts: { width: number; height: number; title?: string }) {
    this.startedAt = Date.now();
    this.header = {
      version: 2,
      width: opts.width,
      height: opts.height,
      timestamp: Math.floor(this.startedAt / 1000),
      title: opts.title,
      env: { TERM: 'xterm-256color' },
    };
  }

  private elapsed(): number {
    return Number(((Date.now() - this.startedAt) / 1000 + this.offset).toFixed(6));
  }

  /** Terminal output, exactly as the PTY emitted it — escape sequences included. */
  output(data: string): void {
    this.events.push([this.elapsed(), 'o', data]);
  }

  /**
   * A prompt line typed in, one character at a time, ahead of the real output.
   *
   * The preamble used to be one event: `C:\...> npm install` painted whole
   * in the first frame, as if the terminal had opened with the command
   * already in it. Nobody's does. The characters are given their own
   * timestamps at a typing rhythm, and every real event after them is
   * shifted by the time that took, so the replay types the command, pauses,
   * and then the command's output starts — in that order, on the clock.
   *
   * @param delays per-character delays in ms, one per character of `line`
   *   (the caller owns the rhythm so this file stays free of the human layer).
   */
  typedPreamble(prompt: string, command: string, delays: number[], enterPauseMs = 350): void {
    let t = 0;
    this.events.push([0, 'o', prompt]);
    for (let i = 0; i < command.length; i++) {
      t += (delays[i] ?? 60) / 1000;
      this.events.push([Number(t.toFixed(6)), 'o', command[i]]);
    }
    t += enterPauseMs / 1000;
    this.events.push([Number(t.toFixed(6)), 'o', '\r\n']);
    this.offset = t;
  }

  /**
   * A keystroke the driver sent.
   *
   * Replay ignores "i" events (the PTY already echoes whatever it chose to
   * echo), but they make the cast readable as a transcript of what the driver
   * actually did, which is most of the value when diagnosing a run that went
   * off the rails at step 7.
   */
  input(data: string): void {
    this.events.push([this.elapsed(), 'i', data]);
  }

  get eventCount(): number {
    return this.events.length;
  }

  build(): Cast {
    return {
      header: { ...this.header, duration: this.elapsed() },
      events: [...this.events],
    };
  }

  save(filePath: string): Cast {
    const cast = this.build();
    writeCast(filePath, cast);
    return cast;
  }
}

export function writeCast(filePath: string, cast: Cast): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const lines = [
    JSON.stringify(cast.header),
    ...cast.events.map((e) => JSON.stringify(e)),
  ];
  writeFileSync(filePath, lines.join('\n') + '\n', 'utf-8');
}

export function readCast(filePath: string): Cast {
  const raw = readFileSync(filePath, 'utf-8');
  const lines = raw.split('\n').filter((l) => l.trim().length > 0);
  if (lines.length === 0) throw new Error(`Empty cast file: ${filePath}`);

  const header = JSON.parse(lines[0]) as CastHeader;
  if (header.version !== 2) {
    throw new Error(`Unsupported cast version ${header.version} in ${filePath}`);
  }

  const events: CastEvent[] = [];
  for (let i = 1; i < lines.length; i++) {
    const parsed = JSON.parse(lines[i]) as CastEvent;
    events.push(parsed);
  }
  return { header, events };
}

/**
 * Compresses long stretches of silence and optionally speeds the whole cast up.
 *
 * `npm install` is four minutes of a spinner. Nobody watches that, but cutting
 * it entirely loses the one thing the install segment is evidence *of* -- that
 * it completed, and roughly how long it took. Capping each gap keeps every
 * frame while making the boring parts pass quickly, and `speed` then scales
 * what remains.
 *
 * Timestamps are rewritten, not dropped, so the replayed cast is still a
 * faithful ordering of what happened.
 */
export function compressCast(
  cast: Cast,
  opts: { maxGapSec?: number; speed?: number } = {},
): Cast {
  const maxGap = opts.maxGapSec ?? 1.2;
  const speed = opts.speed ?? 1;

  let previousSource = 0;
  let cursor = 0;
  const events: CastEvent[] = cast.events.map(([time, code, data]) => {
    const gap = Math.max(0, time - previousSource);
    previousSource = time;
    cursor += Math.min(gap, maxGap) / speed;
    return [Number(cursor.toFixed(6)), code, data];
  });

  return {
    header: { ...cast.header, duration: Number(cursor.toFixed(6)) },
    events,
  };
}

/** Wall-clock seconds the original run took, for the summary table. */
export function castDuration(cast: Cast): number {
  if (cast.header.duration != null) return cast.header.duration;
  const last = cast.events[cast.events.length - 1];
  return last ? last[0] : 0;
}
