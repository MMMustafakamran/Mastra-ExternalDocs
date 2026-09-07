/**
 * frontend/VERSIONS.md — the file the Quickstart demo puts on screen.
 *
 * The Quickstart clip has always led with the dependency manifest, on the
 * reasoning that a demo is only meaningful against known versions. But
 * package.json declares RANGES: it shows "^1.69.2" while the run it is
 * documenting installed 1.69.3, because ci/automate.mjs drops the lockfile so
 * every run tests the newest versions those ranges allow. The one file chosen
 * to prove "known versions" was the one file that could not show them.
 *
 * package-lock.json does carry the resolved versions, but it is 24k lines and
 * scatters the interesting entries hundreds of lines apart, so no highlight
 * range shows them together and every dependency change moves the line numbers.
 *
 * Hence this: small, ordered, and generated after install from the same
 * resolution logic the run report uses, so the clip and the report cannot
 * disagree. Not committed -- it describes one run.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { FRONTEND_DIR } from './lib/config.mjs';
import { getPackageVersions } from './lib/report.mjs';

const OUT = path.join(FRONTEND_DIR, 'VERSIONS.md');

function pad(rows) {
  const width = Math.max(0, ...rows.map(([name]) => name.length));
  return rows.map(([name, version]) => `${name.padEnd(width)}  ${version}`);
}

export function writeVersionsFile() {
  const { frontend, backend } = getPackageVersions();

  const lines = [
    '# Versions in this recording',
    '',
    '# Generated after install. package.json declares RANGES; these are the',
    '# versions those ranges actually resolved to for this run.',
    '',
    '## Frontend',
    '',
    ...pad(Object.entries(frontend ?? {})),
  ];

  if (backend && Object.keys(backend).length) {
    lines.push('', '## Backend', '', ...pad(Object.entries(backend)));
  }
  lines.push('');

  fs.writeFileSync(OUT, lines.join('\n'));
  return OUT;
}

// Runnable on its own so `npm run doctor` and a bare checkout can both
// materialise the file without doing a full recording run.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(`Wrote ${writeVersionsFile()}`);
}
