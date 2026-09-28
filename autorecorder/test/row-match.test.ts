import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rowMatches } from '../core/cli/driver';

/**
 * The projects on the account these recordings run against are `myapp` (MsPy)
 * and `myapp1` (Agno), and Mastra's is the single character `2`. Every case
 * below is one of those, not a hypothetical.
 */

test('substring stays the default, for the framework picker', () => {
  // The framework list is long product names and the config names a fragment.
  assert.equal(rowMatches('Microsoft Agent Framework (Python)', 'Microsoft Agent Framework (Python)'), true);
  assert.equal(rowMatches('Agno', 'Agno'), true);
  assert.equal(rowMatches('Mastra', 'Mastra'), true);
});

test('substring matching lands on the wrong project — the reason exact exists', () => {
  // Not a bug in rowMatches; this is the documented default, shown failing.
  assert.equal(rowMatches('myapp1', 'myapp'), true);
});

test('exact refuses the near-miss row', () => {
  assert.equal(rowMatches('myapp1', 'myapp', true), false);
  assert.equal(rowMatches('myapp', 'myapp', true), true);
  assert.equal(rowMatches('myapp', 'myapp1', true), false);
  assert.equal(rowMatches('myapp1', 'myapp1', true), true);
});

test('exact tolerates the padding a marker glyph leaves behind', () => {
  // `readHighlight` strips the marker but can leave surrounding whitespace.
  assert.equal(rowMatches('  myapp  ', 'myapp', true), true);
  assert.equal(rowMatches('myapp', '  myapp  ', true), true);
});

test('exact is case-insensitive, like the substring path', () => {
  assert.equal(rowMatches('MyApp', 'myapp', true), true);
  assert.equal(rowMatches('NEWPROJ', 'newproj', true), true);
});

test("Mastra's single-character project is unambiguous under exact", () => {
  // '2' as a substring matches any row containing a 2; as an exact match it
  // only matches the row that is exactly '2'.
  assert.equal(rowMatches('2', '2', true), true);
  assert.equal(rowMatches('project-2024', '2', true), false);
  assert.equal(rowMatches('project-2024', '2'), true);
});

test('a row that shares no text never matches either way', () => {
  assert.equal(rowMatches('Create a new project', 'myapp'), false);
  assert.equal(rowMatches('Create a new project', 'myapp', true), false);
});
