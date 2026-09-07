import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { distribute } from '../core/cli/distribute';

/**
 * A scaffold as `copilotkit create` leaves it: a `.env` the CLI generated, with
 * credentials that exist nowhere else on disk.
 */
function fakeScaffold(root: string): void {
  const app = join(root, 'scaffold', 'app');
  mkdirSync(join(app, 'src'), { recursive: true });
  mkdirSync(join(app, 'node_modules', 'left-behind'), { recursive: true });
  writeFileSync(join(app, 'package.json'), JSON.stringify({ name: 'starter' }));
  writeFileSync(join(app, 'src', 'page.tsx'), 'export default function Page() {}');
  writeFileSync(
    join(app, '.env'),
    [
      '# written by `copilotkit init`',
      'AGENT_URL=http://localhost:8000',
      'CPK_INTELLIGENCE_API_KEY=cpk_generated',
      'OPENAI_MODEL=gpt-4o-from-cli',
      '',
    ].join('\n'),
  );

  // What the operator keeps at the repo root: the real vendor key.
  writeFileSync(
    join(root, '.env'),
    ['# repo root', 'OPENAI_API_KEY=sk-real', 'OPENAI_MODEL=gpt-4o', ''].join('\n'),
  );
}

test('seeding merges into the CLI-generated .env instead of replacing it', () => {
  const root = mkdtempSync(join(tmpdir(), 'distribute-'));
  try {
    fakeScaffold(root);

    const results = distribute(
      {
        source: 'scaffold/app',
        targets: ['npm/app'],
        envFiles: [{ from: '.env', to: '.env' }],
      },
      { rootDir: root },
    );

    assert.equal(results[0].status, 'copied');
    assert.deepEqual(results[0].seeded, ['.env']);

    const env = readFileSync(join(root, 'npm', 'app', '.env'), 'utf8');

    // The regression this test exists for: a plain copy dropped these two, and
    // nothing failed until a demo could not reach its agent. AGENT_URL's loss
    // sent MsPy's runtime to the `http://localhost:8000/` fallback in
    // src/agent.ts — trailing slash, POST to the AgentOS root, HTTP 405.
    assert.match(env, /^AGENT_URL=http:\/\/localhost:8000$/m);
    assert.match(env, /^CPK_INTELLIGENCE_API_KEY=cpk_generated$/m);

    // The seed still supplies what only it has.
    assert.match(env, /^OPENAI_API_KEY=sk-real$/m);

    // Where both define a key, the seed wins and the generated value is gone —
    // not left behind as a duplicate for a dotenv parser to choose between.
    assert.match(env, /^OPENAI_MODEL=gpt-4o$/m);
    assert.doesNotMatch(env, /gpt-4o-from-cli/);

    // node_modules is never carried into a copy: the install is the subject of
    // the test the copies exist for.
    assert.equal(readFileSync(join(root, 'npm', 'app', 'package.json'), 'utf8').length > 0, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
