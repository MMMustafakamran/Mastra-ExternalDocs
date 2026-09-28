/**
 * What a failed take leaves behind, on disk and on camera.
 *
 * A clip of a page that broke used to end on the broken page and nothing
 * else. Working out *why* meant re-running the recorder locally with a
 * terminal open beside it. This module gathers the evidence the recorder
 * already has at the moment of failure -- the diagnosed error, the browser
 * console, and the backend and frontend server logs since this page started --
 * and does two things with it:
 *
 *   1. writes `videos/logs/<page-id>.error.log`, a plain-text file an agent can
 *      read without watching anything;
 *   2. renders the same text as a synthetic cast, so the engine can play it in
 *      the simulated terminal window at the end of the clip, scrolled to the
 *      first line that explains the failure.
 *
 * The on-camera terminal is shown only when the take failed. A passing clip
 * stays a person using an app; a failing one becomes a person who hit an error
 * and opened the terminal to read it, which is exactly what a person would do.
 * `console-capture.ts` explains why an always-on console pane was rejected;
 * this is the failure-only compromise.
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Cast } from './cli/cast';
import { type ConsoleEntry } from './console-capture';

/** A server log the pipeline writes, and where it stood when this page began. */
export interface LogSource {
  title: string;
  path: string;
  fromByte: number;
}

export interface EvidenceSection {
  title: string;
  lines: string[];
  /** Index into `lines` of the line most worth reading, or -1. */
  anchor: number;
  /** Lines dropped before the window, when the source was longer than `maxLines`. */
  omittedBefore: number;
}

export interface FailureEvidence {
  pageId: string;
  error: string;
  sections: EvidenceSection[];
  text: string;
}

const DEFAULT_LOGS = [
  { title: 'backend.log', file: 'backend.log' },
  { title: 'frontend.log', file: 'frontend.log' },
];

/**
 * Note where each server log stands now, so the tail shown for this page is
 * this page's and not the whole run's.
 */
export function snapshotLogOffsets(logsDir: string): LogSource[] {
  return DEFAULT_LOGS.flatMap(({ title, file }) => {
    const path = join(logsDir, file);
    if (!existsSync(path)) return [];
    let fromByte = 0;
    try {
      fromByte = statSync(path).size;
    } catch {}
    return [{ title, path, fromByte }];
  });
}

/** Lines that explain a failure, in the order a reader should prefer them. */
const ANCHOR_PATTERNS: RegExp[] = [
  /Traceback \(most recent call last\)/,
  /\b(Unhandled|Uncaught)\b/,
  /\b[A-Z][A-Za-z]*(Error|Exception)\b/,
  /\bERR_[A-Z_]+\b/,
  /\b(5\d\d|404|403)\b/,
  /\b(error|failed|fatal|exception|refused|timed? ?out)\b/i,
];

/** Pick the line most worth reading. Later lines win: the last error is the one that ended the take. */
export function findAnchor(lines: string[]): number {
  for (const re of ANCHOR_PATTERNS) {
    for (let i = lines.length - 1; i >= 0; i--) {
      if (re.test(lines[i])) return i;
    }
  }
  return -1;
}

/**
 * Keep a window of `max` lines around the anchor rather than the first or last
 * `max`. A source with no error-like line at all is context, not cause: show
 * only its tail, and highlight nothing.
 */
function windowAround(lines: string[], max: number): { lines: string[]; anchor: number; omittedBefore: number } {
  const anchor = findAnchor(lines);
  if (anchor < 0) {
    const keep = Math.min(lines.length, 12);
    return { lines: lines.slice(-keep), anchor: -1, omittedBefore: lines.length - keep };
  }
  if (lines.length <= max) return { lines, anchor, omittedBefore: 0 };
  const after = Math.min(Math.floor(max / 3), lines.length - 1 - Math.max(anchor, 0));
  const end = Math.max(anchor, 0) + after + 1;
  const start = Math.max(0, end - max);
  return { lines: lines.slice(start, end), anchor: anchor - start, omittedBefore: start };
}

function readSince(src: LogSource): string[] {
  try {
    const buf = readFileSync(src.path);
    const slice = buf.subarray(Math.min(src.fromByte, buf.length));
    return slice
      .toString('utf8')
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map((l) => l.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')) // strip ANSI the servers print
      .filter((l) => l.trim().length > 0);
  } catch {
    return [];
  }
}

export function buildFailureEvidence(opts: {
  pageId: string;
  error: string;
  consoleEntries?: ConsoleEntry[];
  logs?: LogSource[];
  maxLines?: number;
}): FailureEvidence {
  const maxLines = opts.maxLines ?? 40;
  const sections: EvidenceSection[] = [];

  // Order is for the camera: the terminal holds on its last lines, so the
  // verdict and the browser console -- the parts that name the cause -- come
  // last, after the server logs that give them context.
  for (const src of opts.logs ?? []) {
    const lines = readSince(src);
    if (!lines.length) continue;
    const w = windowAround(lines, maxLines);
    sections.push({ title: `${src.title} (since this page started, ${lines.length} line(s))`, ...w });
  }

  const console_ = (opts.consoleEntries ?? [])
    .filter((e) => e.level === 'error')
    .map((e) => `[${e.level}] ${e.text}${e.source ? `  (${e.source})` : ''}`);
  if (console_.length) {
    const w = windowAround(console_, maxLines);
    sections.push({ title: `Browser console (${console_.length} error line(s))`, ...w });
  }

  const errorLines = opts.error.split('\n').map((l) => l.replace(/^\s+/, '   '));
  sections.push({ title: 'Recorder verdict', lines: errorLines, anchor: 0, omittedBefore: 0 });

  const text = [
    `Page: ${opts.pageId}`,
    `Recorded: ${new Date().toISOString()}`,
    '',
    ...sections.flatMap((s) => [
      `=== ${s.title} ===`,
      ...(s.omittedBefore ? [`... ${s.omittedBefore} earlier line(s) omitted ...`] : []),
      ...s.lines.map((l, i) => (i === s.anchor ? `>> ${l}` : `   ${l}`)),
      '',
    ]),
  ].join('\n');

  return { pageId: opts.pageId, error: opts.error, sections, text };
}

/** `videos/logs/<page-id>.error.log`. Returns the path written. */
export function writeFailureLog(logsDir: string, evidence: FailureEvidence): string {
  mkdirSync(logsDir, { recursive: true });
  const path = join(logsDir, `${evidence.pageId}.error.log`);
  writeFileSync(path, evidence.text, 'utf8');
  return path;
}

const ESC = '\x1b[';
const RESET = `${ESC}0m`;
const DIM = `${ESC}2m`;
const BOLD = `${ESC}1m`;
const RED = `${ESC}31m`;
const YELLOW = `${ESC}33m`;
const CYAN = `${ESC}36m`;
const HIGHLIGHT = `${ESC}41;97;1m`; // red background, bright white, bold

/**
 * The evidence as a cast the terminal window can replay.
 *
 * Lines are emitted quickly (not typed), a beat is left on each section
 * heading, and the anchor line is painted with a red background so the eye
 * lands on it. Each section is windowed around its anchor, so what scrolls
 * into view *is* the relevant part -- the terminal never has to be scrolled
 * back by hand. The cast ends on a summary line and the terminal's own end
 * hold keeps it on screen.
 */
export function evidenceCast(evidence: FailureEvidence, opts: { cols?: number; rows?: number } = {}): Cast {
  const cols = opts.cols ?? 120;
  const rows = opts.rows ?? 32;
  const events: Cast['events'] = [];
  let t = 0;
  const out = (s: string, dt = 0.03) => {
    t += dt;
    events.push([t, 'o', s]);
  };
  const clip = (s: string) => (s.length > cols - 4 ? s.slice(0, cols - 7) + '...' : s);

  out(`${BOLD}${RED}✖ ${evidence.pageId}${RESET} ${DIM}— the take failed; this is what the recorder saw${RESET}\r\n`, 0.4);
  out(`${DIM}${'─'.repeat(Math.min(cols - 1, 100))}${RESET}\r\n`, 0.2);

  for (const s of evidence.sections) {
    out(`\r\n${BOLD}${CYAN}» ${s.title}${RESET}\r\n`, 0.5);
    if (s.omittedBefore) out(`${DIM}   … ${s.omittedBefore} earlier line(s) omitted …${RESET}\r\n`, 0.05);
    s.lines.forEach((line, i) => {
      const body = clip(line);
      if (i === s.anchor) out(`${HIGHLIGHT} ▶ ${body} ${RESET}\r\n`, 0.35);
      else if (/error|exception|failed|traceback/i.test(line)) out(`${YELLOW}   ${body}${RESET}\r\n`, 0.03);
      else out(`${DIM}   ${body}${RESET}\r\n`, 0.02);
    });
  }

  out(`\r\n${DIM}${'─'.repeat(Math.min(cols - 1, 100))}${RESET}\r\n`, 0.3);
  out(`${BOLD}Saved:${RESET} videos/logs/${evidence.pageId}.error.log\r\n`, 0.3);

  return {
    header: {
      version: 2,
      width: cols,
      height: rows,
      timestamp: Math.floor(Date.now() / 1000),
      title: `Error console — ${evidence.pageId}`,
      env: { TERM: 'xterm-256color' },
    },
    events,
  };
}
