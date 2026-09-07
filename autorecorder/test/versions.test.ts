import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { hasInstalledTree, writeVersionsFile } from '../core/cli/versions';

function fakeApp(root: string, app: string): void {
  const dir = join(root, app);
  mkdirSync(join(dir, 'node_modules', '@copilotkit', 'react-core'), { recursive: true });
  mkdirSync(join(dir, 'node_modules', 'next'), { recursive: true });
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({
      dependencies: { '@copilotkit/react-core': '^1.69.2', next: '16.3.2', missing: '^1.0.0' },
      devDependencies: { typescript: '^5' },
    }),
  );
  writeFileSync(join(dir, 'node_modules', '@copilotkit', 'react-core', 'package.json'), JSON.stringify({ version: '1.69.3' }));
  writeFileSync(join(dir, 'node_modules', 'next', 'package.json'), JSON.stringify({ version: '16.3.2' }));
}

test('writeVersionsFile reports installed versions and names what is missing', () => {
  const root = mkdtempSync(join(tmpdir(), 'versions-'));
  try {
    fakeApp(root, 'app');
    assert.equal(hasInstalledTree(root, 'app'), true);
    assert.equal(hasInstalledTree(root, 'nope'), false);

    const result = writeVersionsFile(root, 'app', { label: 'test app' });
    assert.ok(result);
    assert.deepEqual(result.resolved, { '@copilotkit/react-core': '1.69.3', next: '16.3.2' });
    assert.deepEqual(result.unresolved, ['missing', 'typescript']);

    const text = readFileSync(result.file, 'utf-8');
    assert.match(text, /## test app/);
    assert.match(text, /@copilotkit\/react-core\s+1\.69\.3/);
    assert.match(text, /## Declared but not installed\n\nmissing\ntypescript/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('writeVersionsFile returns null when there is no package.json', () => {
  const root = mkdtempSync(join(tmpdir(), 'versions-'));
  try {
    assert.equal(writeVersionsFile(root, 'app'), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
