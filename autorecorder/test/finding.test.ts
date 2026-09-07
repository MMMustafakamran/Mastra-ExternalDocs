import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildFindingNote } from '../core/cli/finding';
import { type CliFlowConfig } from '../core/cli/flow';

const flow: CliFlowConfig = {
  id: 'install-bun',
  name: 'Install dependencies — bun',
  castName: 'Install-bun',
  cwd: '1-cli-testing/bun/app',
  command: 'bun',
  args: ['install'],
  order: 6,
  castFile: 'x.cast',
  reportFile: 'x.report.json',
};

const report = {
  exitCode: 1,
  error: 'Exited 1, expected 0.',
  missingFiles: ['1-cli-testing/bun/app/node_modules'],
  tail: ['bun install v1.2.0', '', '1373 packages installed', 'error: script "install:agent" exited with code 1', 'bun: command not found: scriptssetup-agent.bat'].join('\n'),
  durationSec: 41.6,
};

test('the note leads with the command, the exit code and the last screen', () => {
  const note = buildFindingNote(flow, report);
  assert.match(note, /^bun install failed\n/);
  assert.match(note, /ran in 1-cli-testing\/bun\/app, took 42s/);
  assert.match(note, /exit code 1/);
  assert.match(note, /expected but not there afterwards: 1-cli-testing\/bun\/app\/node_modules/);
  assert.match(note, /last thing on screen:\n  bun install v1\.2\.0\n  1373 packages installed/);
  assert.match(note, /scriptssetup-agent\.bat/);
  assert.doesNotMatch(note, /Exited 1, expected 0/, 'the driver error is redundant once the screen tail shows it');
});

test('hand-written analysis goes underneath, and never replaces the facts', () => {
  const note = buildFindingNote(flow, report, 'why: the backslash is eaten by bun\'s shell');
  const facts = note.indexOf('last thing on screen');
  const why = note.indexOf('why: the backslash');
  assert.ok(facts !== -1 && why > facts);
});

test('a report with no tail still says what failed', () => {
  const note = buildFindingNote(flow, { ...report, tail: '', missingFiles: [] });
  assert.match(note, /bun install failed/);
  assert.match(note, /exit code 1/);
  assert.doesNotMatch(note, /last thing on screen/);
  // A driver message that is not just the exit code is kept.
  const timedOut = buildFindingNote(flow, { ...report, tail: '', error: 'Run exceeded 900s and was killed.' });
  assert.match(timedOut, /Run exceeded 900s/);
});

test('long screen lines are cut so they fit the Notepad window', () => {
  const long = 'x'.repeat(300);
  const note = buildFindingNote(flow, { ...report, tail: long });
  const line = note.split('\n').find((l) => l.includes('xxx'))!;
  assert.ok(line.length <= 112);
  assert.ok(line.endsWith('…'));
});
