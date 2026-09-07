import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { CastRecorder, castDuration, compressCast, readCast, writeCast, type Cast } from '../core/cli/cast';

const sample: Cast = {
  header: { version: 2, width: 80, height: 24, timestamp: 0, duration: 10 },
  events: [
    [0, 'o', 'a'],
    [0.5, 'o', 'b'],
    [5.5, 'o', 'c'], // 5s gap
    [6, 'i', '\r'],
    [10, 'o', 'd'], // 4s gap
  ],
};

test('compressCast caps gaps and keeps every event in order', () => {
  const out = compressCast(sample, { maxGapSec: 1 });
  assert.equal(out.events.length, sample.events.length);
  assert.deepEqual(
    out.events.map((e) => e[0]),
    [0, 0.5, 1.5, 2, 3],
  );
  assert.equal(out.header.duration, 3);
  assert.deepEqual(out.events.map((e) => e[2]), ['a', 'b', 'c', '\r', 'd']);
});

test('compressCast applies speed after capping', () => {
  const out = compressCast(sample, { maxGapSec: 1, speed: 2 });
  assert.deepEqual(
    out.events.map((e) => e[0]),
    [0, 0.25, 0.75, 1, 1.5],
  );
});

test('compressCast leaves the input untouched', () => {
  const before = JSON.stringify(sample);
  compressCast(sample, { maxGapSec: 0.1, speed: 10 });
  assert.equal(JSON.stringify(sample), before);
});

test('castDuration prefers the header and falls back to the last event', () => {
  assert.equal(castDuration(sample), 10);
  assert.equal(castDuration({ header: { ...sample.header, duration: undefined }, events: sample.events }), 10);
  assert.equal(castDuration({ header: { ...sample.header, duration: undefined }, events: [] }), 0);
});

test('writeCast/readCast round-trip an asciicast v2 file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cast-'));
  try {
    const file = join(dir, 'x.cast');
    writeCast(file, sample);
    const back = readCast(file);
    assert.deepEqual(back, sample);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CastRecorder records output and input with monotonic timestamps', async () => {
  const rec = new CastRecorder({ width: 10, height: 5, title: 't' });
  rec.output('hello');
  await new Promise((r) => setTimeout(r, 15));
  rec.input('\r');
  const cast = rec.build();
  assert.equal(cast.events.length, 2);
  assert.equal(cast.events[0][1], 'o');
  assert.equal(cast.events[1][1], 'i');
  assert.ok(cast.events[1][0] >= cast.events[0][0]);
  assert.ok((cast.header.duration ?? 0) >= cast.events[1][0]);
});
