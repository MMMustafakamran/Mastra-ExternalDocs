import { type CliRunResult } from './driver';
import { type CliFlowConfig } from './flow';

/**
 * The written half of a finding clip, built from the capture report.
 *
 * A failed install has to become a clip that explains itself to someone who
 * was not here, and it has to do so the same night the install failed —
 * before anyone has looked at why. So the note leads with what the report
 * already knows: the command, where it ran, how it exited, what it was meant
 * to produce and did not, and the last lines the terminal showed. A person's
 * analysis, when one exists, goes underneath; the error itself never waits
 * on it.
 *
 * Written the way a tester jots at the end of a run, not the way a report is
 * filed: lower case, no headings, the facts in the order they were noticed.
 */
export function buildFindingNote(
  flow: CliFlowConfig,
  report: Pick<CliRunResult, 'exitCode' | 'error' | 'missingFiles' | 'tail' | 'durationSec'>,
  analysis?: string,
  opts: { tailLines?: number } = {},
): string {
  const command = [flow.command, ...(flow.args ?? [])].join(' ');
  const lines: string[] = [];

  lines.push(`${command} failed`);
  lines.push('');
  lines.push(`ran in ${flow.cwd}, took ${Math.round(report.durationSec)}s`);
  if (report.exitCode != null) lines.push(`exit code ${report.exitCode}`);
  if (report.missingFiles.length) {
    lines.push(`expected but not there afterwards: ${report.missingFiles.join(', ')}`);
  }

  const tail = report.tail
    .split('\n')
    .map((l) => l.trimEnd())
    .filter((l) => l.length > 0)
    .slice(-(opts.tailLines ?? 8));
  if (tail.length) {
    lines.push('');
    lines.push('last thing on screen:');
    for (const l of tail) lines.push(`  ${l.length > 110 ? `${l.slice(0, 109)}…` : l}`);
  }

  // The driver's own summary adds something only when it is not the exit
  // code (already stated) and not a line the screen tail already shows.
  const restatesExit = /^Exited -?\d+, expected/.test(report.error ?? '');
  if (report.error && !restatesExit && !tail.some((l) => report.error?.includes(l))) {
    lines.push('');
    lines.push(report.error.split('\n')[0]);
  }

  if (analysis?.trim()) {
    lines.push('');
    lines.push(analysis.trim());
  }

  return lines.join('\n');
}
