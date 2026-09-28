import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Cast, type CastEvent } from './cli/cast';
import { type IdeTabConfig } from './ide/generator';

/**
 * Lines that identify an IDE tab's snippet on the doc page: its three longest
 * code lines, whitespace-collapsed. Comments are skipped -- the project files
 * carry provenance comments the doc does not.
 */
export function snippetProbes(rootDir: string, tab: IdeTabConfig): string[] {
  const path = join(rootDir, tab.filePath);
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .replace(/\r/g, '')
    .split('\n')
    .slice(tab.startLine - 1, tab.endLine)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l.length >= 10 && !/^(\/\/|#|\*|\/\*)/.test(l))
    .sort((a, b) => b.length - a.length)
    .slice(0, 3);
}

/** One command to show being run, and the log file its output went to. */
export interface RunCommand {
  cmd: string;
  /** File name under autorecorder/videos/logs/, as ci/automate.mjs writes it. */
  log: string;
  /** Stop replaying the log after the first line matching this. */
  ready: RegExp;
}

/**
 * A terminal cast that types each command and prints its real startup output,
 * read from the server logs of this run. Null when no log exists: nothing is
 * shown rather than invented output.
 */
export function runCommandsCast(rootDir: string, commands: RunCommand[]): Cast | null {
  const events: CastEvent[] = [];
  let t = 0.4;
  let shown = 0;
  for (const c of commands) {
    const logPath = join(rootDir, 'autorecorder', 'videos', 'logs', c.log);
    if (!existsSync(logPath)) continue;
    const lines = readFileSync(logPath, 'utf8').replace(/\r/g, '').split('\n');
    const end = lines.findIndex((l) => c.ready.test(l));
    const output = lines.slice(0, end === -1 ? 14 : end + 1).filter((l) => l.trim()).slice(-14);

    events.push([t, 'o', '\x1b[32m$\x1b[0m ']);
    for (const ch of c.cmd) {
      t += 0.045 + Math.random() * 0.06;
      events.push([t, 'o', ch]);
    }
    t += 0.35;
    events.push([t, 'o', '\r\n']);
    for (const line of output) {
      t += 0.12;
      events.push([t, 'o', line + '\r\n']);
    }
    t += 1.2;
    shown++;
  }
  if (shown === 0) return null;
  return {
    header: { version: 2, width: 110, height: 30, timestamp: Math.floor(Date.now() / 1000), title: 'Terminal' },
    events,
  };
}
