/**
 * Fans one scaffold out into the per-package-manager directories, and seeds the
 * model key into each copy.
 *
 * Why copy rather than scaffold four times: the CLI produces the same project
 * every time, and running it four times would make the *scaffold* a variable in
 * a test whose only subject is the install. Copying once means the four trees
 * are byte-identical, so a difference in what installs — a lockfile that
 * resolves differently, a postinstall that fails under one manager — is
 * attributable to the manager and nothing else.
 *
 * Why the key is seeded here rather than typed into the CLI: the scaffold is
 * deliberately created without one, so no recording ever contains a secret.
 * Placing it once before the copy also means it cannot be typo'd into three of
 * four directories.
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

/** `KEY` out of a `KEY=value` line, ignoring comments and blanks. */
function envKeyOf(line: string): string | null {
  const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
  return match ? match[1] : null;
}

/**
 * Merges a seed env file into one the CLI already wrote, instead of replacing it.
 *
 * `copilotkit create` writes a `.env` of its own — Intelligence credentials,
 * and for agent starters an `AGENT_URL`. Copying the repo-root `.env` over that
 * file destroys those values, and both losses are silent until a demo fails:
 *
 *   - Mastra lost `CPK_INTELLIGENCE_API_KEY`, so the runtime dropped to its
 *     in-memory runner.
 *   - MsPy lost `AGENT_URL=http://localhost:8000`, so `src/agent.ts` fell back
 *     to `"http://localhost:8000/"` — with a trailing slash — and POSTed to the
 *     AgentOS root, which answers `405 Method Not Allowed`.
 *
 * Merging is also what the CLI's own success banner tells a reader to do: "Set
 * OPENAI_API_KEY in .env — **add the line**". Generated values are kept, the
 * seed file's assignments win where both define a key (the seed is where the
 * real secret lives), and anything the seed adds is appended under a comment
 * saying where it came from.
 */
function mergeEnvInto(generatedPath: string, seedText: string): string {
  const seedLines = seedText.split(/\r?\n/);
  const seedKeys = new Set(seedLines.map(envKeyOf).filter((k): k is string => Boolean(k)));

  // The seed's own comments are dropped: a documented .env.example-style file
  // would otherwise bury the generated block under paragraphs of prose.
  const seedAssignments = seedLines.filter((l) => envKeyOf(l));

  const generated = existsSync(generatedPath)
    ? readFileSync(generatedPath, 'utf8').replace(/^﻿/, '')
    : '';

  // A key the seed also defines is dropped here so the seed's value is the only
  // one left, rather than relying on which duplicate the dotenv parser prefers.
  const kept = generated
    .split(/\r?\n/)
    .filter((l) => {
      const key = envKeyOf(l);
      return !(key && seedKeys.has(key));
    });

  return [...kept, '', '# --- seeded by the recorder', ...seedAssignments, ''].join('\n');
}

export interface EnvSeed {
  /** Source file, relative to the repo root. */
  from: string;
  /** Destination, relative to each target directory. */
  to: string;
}

export interface DistributionConfig {
  /** The freshly scaffolded app, relative to the repo root. */
  source: string;

  /** Where copies land, relative to the repo root. */
  targets: string[];

  /**
   * Directory names never copied.
   *
   * `node_modules` above all: copying an install into all four defeats the
   * entire point, and it is also the slowest thing on disk.
   */
  exclude?: string[];

  /** Files copied into every target once the tree is in place. */
  envFiles?: EnvSeed[];
}

export interface DistributeResult {
  target: string;
  status: 'copied' | 'skipped' | 'failed';
  /** Env files actually written into this target. */
  seeded: string[];
  /** Env files whose source was missing. */
  missingEnv: string[];
  error?: string;
}

const DEFAULT_EXCLUDE = ['node_modules', '.next', '.git', '.turbo'];

/** Rough size guard, so a mis-set source cannot silently copy a huge tree. */
function countEntries(dir: string, exclude: Set<string>, budget = 20000): number {
  let seen = 0;
  const walk = (current: string): void => {
    if (seen > budget) return;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (exclude.has(entry.name)) continue;
      seen++;
      if (seen > budget) return;
      if (entry.isDirectory()) walk(join(current, entry.name));
    }
  };
  walk(dir);
  return seen;
}

export function distribute(
  config: DistributionConfig,
  opts: { rootDir: string; force?: boolean },
): DistributeResult[] {
  const sourceAbs = join(opts.rootDir, config.source);

  if (!existsSync(sourceAbs)) {
    throw new Error(
      `Nothing to distribute: ${config.source} does not exist. ` +
        `Run the scaffold first (npm run capture -- --scaffold).`,
    );
  }
  if (!statSync(sourceAbs).isDirectory()) {
    throw new Error(`Distribution source ${config.source} is not a directory.`);
  }

  const exclude = new Set(config.exclude ?? DEFAULT_EXCLUDE);
  const entryCount = countEntries(sourceAbs, exclude);
  console.log(
    `\n📦 Distributing ${config.source} (${entryCount}${entryCount > 19999 ? '+' : ''} entries, excluding ${[...exclude].join(', ')})`,
  );

  const results: DistributeResult[] = [];

  for (const target of config.targets) {
    const targetAbs = join(opts.rootDir, target);
    const result: DistributeResult = { target, status: 'copied', seeded: [], missingEnv: [] };

    try {
      if (existsSync(targetAbs)) {
        if (!opts.force) {
          // Overwriting someone's installed tree without asking is not a
          // recoverable mistake — node_modules is not in version control.
          console.log(`   ⏭  ${target} already exists — skipped (pass --force to replace)`);
          results.push({ ...result, status: 'skipped' });
          continue;
        }
        console.log(`   🗑  ${target} exists — replacing (--force)`);
        rmSync(targetAbs, { recursive: true, force: true });
      }

      mkdirSync(dirname(targetAbs), { recursive: true });
      cpSync(sourceAbs, targetAbs, {
        recursive: true,
        // Filter receives absolute paths; comparing the basename keeps the rule
        // "never copy a directory with this name", at any depth.
        filter: (src) => !exclude.has(src.split(/[\\/]/).pop() ?? ''),
      });
      console.log(`   ✓ ${config.source} -> ${target}`);

      for (const seed of config.envFiles ?? []) {
        const fromAbs = join(opts.rootDir, seed.from);
        if (!existsSync(fromAbs)) {
          result.missingEnv.push(seed.from);
          continue;
        }
        const toAbs = join(targetAbs, seed.to);
        mkdirSync(dirname(toAbs), { recursive: true });
        // Merge, never overwrite — the destination is the CLI's own .env, and
        // replacing it silently drops the credentials it generated. See
        // mergeEnvInto.
        writeFileSync(toAbs, mergeEnvInto(toAbs, readFileSync(fromAbs, 'utf8')), 'utf8');
        result.seeded.push(seed.to);
      }

      if (result.seeded.length) {
        console.log(`     key seeded into: ${result.seeded.join(', ')}`);
      }
      for (const missing of result.missingEnv) {
        console.warn(
          `     ⚠️ ${missing} not found — ${target} has no model key and its agent will fail to answer`,
        );
      }
    } catch (e) {
      result.status = 'failed';
      result.error = e instanceof Error ? e.message : String(e);
      console.error(`   ✗ ${target}: ${result.error}`);
    }

    results.push(result);
  }

  return results;
}
