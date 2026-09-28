import assert from 'node:assert/strict';
import { test } from 'node:test';
import { breakingErrors, type ConsoleEntry } from '../core/console-capture';

const e = (text: string, source?: string, level: ConsoleEntry['level'] = 'error'): ConsoleEntry => ({
  level,
  text,
  source,
});

const breaks = (entry: ConsoleEntry) => breakingErrors([entry]).length === 1;

test('an uncaught exception breaks the take', () => {
  assert.ok(breaks(e('boom is not defined', 'Uncaught')));
});

test("Angular's ErrorHandler output and NG codes break the take", () => {
  assert.ok(breaks(e('ERROR Error: something threw in a component', 'main.js:12')));
  assert.ok(breaks(e('NG0100: ExpressionChangedAfterItHasBeenCheckedError', 'core.mjs:3')));
});

test('a failed request to a local harness server breaks the take', () => {
  assert.ok(
    breaks(e('POST http://localhost:8230/api/copilotkit/agent/default/run net::ERR_CONNECTION_REFUSED', 'network')),
  );
  assert.ok(breaks(e('GET http://127.0.0.1:8231/ok net::ERR_EMPTY_RESPONSE', 'network')));
});

test('a cancelled request is not a failure', () => {
  assert.ok(!breaks(e('GET http://localhost:8230/api/copilotkit/inspector-metadata net::ERR_ABORTED', 'network')));
});

test('third-party request failures and library console.error stay warnings', () => {
  assert.ok(!breaks(e('GET https://fonts.gstatic.com/s/x.woff2 net::ERR_FAILED', 'network')));
  assert.ok(!breaks(e('[CopilotKit] reconnecting', 'core.mjs:9')));
});

test('warnings never break the take', () => {
  assert.ok(!breaks(e('ERROR looks bad', 'x', 'warning')));
});
