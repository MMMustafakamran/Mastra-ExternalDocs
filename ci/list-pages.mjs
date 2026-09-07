#!/usr/bin/env node
/**
 * Print the recorder's page ids.
 *
 * Exists so the workflow (and anyone typing `--pages=`) can see the valid ids
 * without opening the TypeScript config or trusting a hand-copied list.
 *
 *   node ci/list-pages.mjs          one id per line
 *   node ci/list-pages.mjs --json   JSON array
 *   node ci/list-pages.mjs --csv    comma-separated
 */
import { readPageIds } from './lib/pages.mjs';

const ids = readPageIds();
const args = process.argv.slice(2);

if (args.includes('--json')) {
  console.log(JSON.stringify(ids));
} else if (args.includes('--csv')) {
  console.log(ids.join(','));
} else {
  for (const id of ids) console.log(id);
}
