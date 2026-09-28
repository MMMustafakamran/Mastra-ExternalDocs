import assert from 'node:assert/strict';
import { test } from 'node:test';
import { looksUnredacted, redactText } from '../core/cli/redact';

/**
 * The strings under test are lifted from `casts/MSPY-react-cli-01-Login.cast`
 * and its report — a real capture, not an invention. The wrapped `state` token
 * in particular is why this module reads past a line break: a 32-character
 * token in a 120-column terminal is split, and a plain
 * /state=[0-9a-f]{32}/ leaves both halves on camera.
 */
const REAL_AUTH_LINE =
  'https://dashboard.operations.copilotkit.ai/cli-auth?callback=http%3A%2F%2F127.0.0.1%3A65383%2Fcallback&state=11278bc6d01\n' +
  '0d080bf8e9bec011c93f6&posthog_distinct_id=b24dd771-d0bb-4eda-ab1c-9ff2e4865efe';

test('masks a state token split across a hard wrap', () => {
  const out = redactText(REAL_AUTH_LINE);

  assert.ok(!out.includes('11278bc6d01'), 'first half of the token survived');
  assert.ok(!out.includes('0d080bf8e9bec011c93f6'), 'second half survived');
  assert.ok(!out.includes('b24dd771-d0bb-4eda-ab1c-9ff2e4865efe'), 'posthog id survived');
});

test('masking preserves length and line structure', () => {
  const out = redactText(REAL_AUTH_LINE);

  assert.equal(out.length, REAL_AUTH_LINE.length, 'length changed — the replay would reflow');
  assert.equal(
    out.split('\n').length,
    REAL_AUTH_LINE.split('\n').length,
    'line count changed',
  );
  // The wrap inside the masked run is kept, so the terminal still breaks where
  // it really broke.
  assert.ok(out.includes('x\n0'.replace('0', 'x')), 'the wrap inside the token was not preserved');
});

test('keeps the parts that make the cast readable', () => {
  const out = redactText(REAL_AUTH_LINE);

  assert.ok(out.includes('dashboard.operations.copilotkit.ai/cli-auth'), 'host was masked');
  assert.ok(out.includes('state='), 'the label itself should stay');
  assert.ok(out.includes('posthog_distinct_id='), 'the label itself should stay');
});

test('masks the operator email printed on a successful login', () => {
  const out = redactText('Email: mustaf.kamran@fiqros.org');

  assert.ok(!out.includes('mustaf.kamran@fiqros.org'));
  assert.ok(out.startsWith('Email: '), 'the label should survive');
  assert.equal(out.length, 'Email: mustaf.kamran@fiqros.org'.length);
});

test('masks credential shapes that carry no label', () => {
  const jwt = 'eyJhbGciOiJFZERTQSJ9.eyJzdWIiOiJhY21lIn0.c2lnbmF0dXJlLWhlcmU';
  assert.ok(!redactText('token ' + jwt).includes(jwt));

  const openai = 'sk-proj-AbCdEfGhIjKlMnOpQrStUv';
  assert.ok(!redactText('OPENAI: ' + openai).includes(openai));

  const cpk = 'cpk_live_9f8e7d6c5b4a3210';
  assert.ok(!redactText(cpk).includes(cpk));
});

test('masks env assignments the CLI echoes', () => {
  const out = redactText('CPK_INTELLIGENCE_API_KEY=abcd1234efgh5678ijkl');
  assert.ok(!out.includes('abcd1234efgh5678ijkl'));
  assert.ok(out.startsWith('CPK_INTELLIGENCE_API_KEY='), 'the variable name should stay readable');
});

test('a newline ends the value when what follows is ordinary output', () => {
  // The failure this guards: absorbing the wrap unconditionally would eat the
  // next line of the CLI's own output and mask it as part of the token.
  const input = 'state=abc\nTip: Reach for CopilotChat before building a chat shell.';
  const out = redactText(input);

  assert.ok(
    out.includes('Tip: Reach for CopilotChat before building a chat shell.'),
    'the following line was swallowed into the masked run',
  );
});

test('leaves output with nothing sensitive in it byte-identical', () => {
  const plain = 'added 402 packages, and audited 403 packages in 12s\r\nfound 0 vulnerabilities\r\n';
  assert.equal(redactText(plain), plain);
  assert.equal(looksUnredacted(plain), false);
});

test('preserves ANSI escape sequences around a masked value', () => {
  const esc = String.fromCharCode(27);
  const input = esc + '[1mstate=deadbeefcafe1234' + esc + '[0m';
  const out = redactText(input);

  assert.ok(out.startsWith(esc + '[1mstate='), 'leading escape sequence was disturbed');
  assert.ok(out.endsWith(esc + '[0m'), 'trailing escape sequence was disturbed');
  assert.ok(!out.includes('deadbeefcafe1234'));
});

test('looksUnredacted flags a chunk that still carries a credential', () => {
  assert.equal(looksUnredacted('Email: someone@example.com'), true);
  assert.equal(looksUnredacted('nothing to see here'), false);
});
