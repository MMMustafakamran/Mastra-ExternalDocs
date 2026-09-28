import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  buildFailureEvidence,
  evidenceCast,
  findAnchor,
  snapshotLogOffsets,
  writeFailureLog,
} from '../core/failure-evidence';

test('findAnchor prefers a traceback, then the last error-like line', () => {
  assert.equal(findAnchor(['ok', 'Traceback (most recent call last):', '  File x', 'ValueError: bad']), 1);
  assert.equal(findAnchor(['INFO started', 'GET /run 404', 'INFO idle']), 1);
  assert.equal(findAnchor(['a', 'b']), -1);
  assert.equal(findAnchor([]), -1);
});

test('log tail is sliced from the offset taken when the page started', () => {
  const dir = mkdtempSync(join(tmpdir(), 'evidence-'));
  const backend = join(dir, 'backend.log');
  writeFileSync(backend, 'old line 1\nold line 2\n');
  const logs = snapshotLogOffsets(dir);
  assert.equal(logs.length, 1);
  writeFileSync(backend, 'old line 1\nold line 2\nnew INFO\nnew Exception: boom\n');

  const ev = buildFailureEvidence({ pageId: 'p', error: 'Demo step failed: x', logs });
  const section = ev.sections.find((s) => s.title.startsWith('backend.log'))!;
  assert.deepEqual(section.lines, ['new INFO', 'new Exception: boom']);
  assert.equal(section.anchor, 1);
  assert.ok(ev.text.includes('>> new Exception: boom'));

  const file = writeFailureLog(dir, ev);
  assert.equal(readFileSync(file, 'utf8'), ev.text);
  assert.ok(file.endsWith('p.error.log'));
});

test('long logs are windowed around the anchor, not truncated at the head', () => {
  const lines = Array.from({ length: 200 }, (_, i) => (i === 150 ? 'RuntimeError: here' : `line ${i}`));
  const dir = mkdtempSync(join(tmpdir(), 'evidence-'));
  writeFileSync(join(dir, 'frontend.log'), lines.join('\n'));
  const ev = buildFailureEvidence({ pageId: 'p', error: 'x', logs: snapshotLogOffsets(dir).map((l) => ({ ...l, fromByte: 0 })), maxLines: 30 });
  const s = ev.sections.find((x) => x.title.startsWith('frontend.log'))!;
  assert.equal(s.lines.length, 30);
  assert.equal(s.lines[s.anchor], 'RuntimeError: here');
  assert.ok(s.omittedBefore > 0);
});

test('the cast highlights the anchor and ends on the log path', () => {
  const ev = buildFailureEvidence({
    pageId: 'quickstart',
    error: '⚠️ [Route Not Found (404)]: The requested URL could not be found.',
    consoleEntries: [
      { level: 'error', text: 'Failed to load resource: 404 (run:0)' },
      { level: 'info', text: 'ignored' },
    ],
  });
  const cast = evidenceCast(ev);
  const out = cast.events.map((e) => e[2]).join('');
  assert.ok(out.includes('\x1b[41;97;1m'));
  assert.ok(out.includes('quickstart.error.log'));
  assert.ok(!out.includes('ignored'));
  assert.ok(cast.events.every(([, code]) => code === 'o'));
});
