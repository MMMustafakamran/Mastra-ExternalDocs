import assert from 'node:assert/strict';
import { test } from 'node:test';
import { highlightedLabel, lastLines, stripAnsi, tailMatches, toScreenText } from '../core/cli/screen';

const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);

test('stripAnsi removes CSI colour and cursor sequences', () => {
  const raw = `${ESC}[32m✔${ESC}[0m done ${ESC}[2K${ESC}[1A`;
  assert.equal(stripAnsi(raw), '✔ done ');
});

test('stripAnsi removes OSC window-title sequences terminated by BEL', () => {
  const raw = `${ESC}]0;Windows PowerShell${BEL}prompt>`;
  assert.equal(stripAnsi(raw), 'prompt>');
});

test('toScreenText turns bare carriage returns into line breaks', () => {
  const raw = 'spinner frame 1\rspinner frame 2\r\nnext';
  assert.equal(toScreenText(raw), 'spinner frame 1\nspinner frame 2\nnext');
});

test('highlightedLabel reads the last marked row, from the freshest repaint', () => {
  const frame1 = '  Select agent framework\n❯ LangGraph (Python)\n  Mastra\n';
  const frame2 = `${ESC}[2A  LangGraph (Python)\n❯ Mastra\n`;
  assert.equal(highlightedLabel(frame1), 'LangGraph (Python)');
  assert.equal(highlightedLabel(frame1 + frame2), 'Mastra');
});

test('highlightedLabel strips list numbering and ignores a bare cursor marker', () => {
  assert.equal(highlightedLabel('❯ 3. Slack\n'), 'Slack');
  assert.equal(highlightedLabel('❯ 12) Discord\n'), 'Discord');
  assert.equal(highlightedLabel('> \n'), null);
  assert.equal(highlightedLabel('no markers here\n'), null);
});

test('highlightedLabel honours custom markers', () => {
  assert.equal(highlightedLabel('* Custom row\n', ['*']), 'Custom row');
  assert.equal(highlightedLabel('❯ Default row\n', ['*']), null);
});

test('tailMatches only looks at the end of the stream', () => {
  const old = 'Select a project\n';
  const filler = 'x'.repeat(25_000);
  assert.equal(tailMatches(old + filler, /Select a project/), false);
  assert.equal(tailMatches(filler + old, /Select a project/), true);
  assert.equal(tailMatches(filler + old, 'select A PROJECT'), true, 'string patterns are case-insensitive');
});

test('lastLines drops blank lines and keeps the last N', () => {
  const raw = 'a\n\n\nb\r\nc\n';
  assert.equal(lastLines(raw, 2), 'b\nc');
});
