#!/usr/bin/env node
/**
 * Fail a dispatch early when the pages field contains an unknown id.
 *
 * Without this a typo costs the whole matrix: three shards spin up servers,
 * record nothing, and report success.
 *
 *   node ci/validate-pages.mjs "quickstart,readables"
 */
import { assertGroupsCoverAllPages, resolvePageSelection } from './lib/pages.mjs';

try {
  // Same guard as resolve-selection.mjs: an ungrouped page is a config error
  // whether or not this particular run names it.
  assertGroupsCoverAllPages();

  const selected = resolvePageSelection(process.argv[2]);
  console.log(
    selected.length > 0
      ? `✅ ${selected.length} page id(s) valid: ${selected.join(', ')}`
      : 'ℹ️ No pages specified; recording all pages.',
  );
} catch (err) {
  console.error(`❌ ${err.message}`);
  process.exit(1);
}
