/**
 * VERSIONS.md for a scaffolded app — what actually got installed.
 *
 * `package.json` declares RANGES. A demo that leads with `"^1.69.2"` while the
 * run it documents installed 1.69.3 puts the one file on screen that cannot
 * answer "which versions is this?". The lockfile does carry resolved versions,
 * but it is tens of thousands of lines with the interesting entries scattered
 * hundreds apart, so no highlight range shows them together and every
 * dependency change moves the line numbers.
 *
 * Hence a small generated file, read from the installed tree after install, so
 * the clip shows the versions the recording actually ran against.
 *
 * Deliberately standalone rather than reusing `ci/`: `core/` may not depend on
 * anything outside this folder, or the recorder stops being portable.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface VersionsResult {
  /** Absolute path written. */
  file: string;
  /** Declared range -> resolved version, for the ones that resolved. */
  resolved: Record<string, string>;
  /** Declared dependencies with nothing installed under node_modules. */
  unresolved: string[];
}

function readJson(file: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(file, 'utf-8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function pad(rows: [string, string][]): string[] {
  const width = Math.max(0, ...rows.map(([name]) => name.length));
  return rows.map(([name, version]) => `${name.padEnd(width)}  ${version}`);
}

/**
 * Writes `<appDir>/VERSIONS.md` from the app's declared dependencies and what
 * is installed under its `node_modules`.
 *
 * Returns null when the app has no `package.json` — a caller that has not run
 * the scaffold yet should not be made to handle an exception for it.
 */
export function writeVersionsFile(
  rootDir: string,
  appDir: string,
  opts: { label?: string } = {},
): VersionsResult | null {
  const appAbs = join(rootDir, appDir);
  const manifest = readJson(join(appAbs, 'package.json'));
  if (!manifest) return null;

  const declared: Record<string, string> = {
    ...((manifest.dependencies as Record<string, string>) ?? {}),
    ...((manifest.devDependencies as Record<string, string>) ?? {}),
  };

  const resolved: Record<string, string> = {};
  const unresolved: string[] = [];

  for (const name of Object.keys(declared).sort()) {
    const installed = readJson(join(appAbs, 'node_modules', name, 'package.json'));
    const version = installed?.version;
    if (typeof version === 'string') {
      resolved[name] = version;
    } else {
      unresolved.push(name);
    }
  }

  const lines = [
    '# Versions in this recording',
    '',
    '# Generated after install. package.json declares RANGES; these are the',
    '# versions those ranges actually resolved to for this run.',
    '',
    `## ${opts.label ?? appDir}`,
    '',
    ...pad(Object.entries(resolved).map(([n, v]) => [n, v] as [string, string])),
  ];

  if (unresolved.length) {
    lines.push(
      '',
      '## Declared but not installed',
      '',
      ...unresolved,
    );
  }

  const file = join(appAbs, 'VERSIONS.md');
  writeFileSync(file, lines.join('\n') + '\n', 'utf-8');
  return { file, resolved, unresolved };
}

/** True when the app has an installed tree worth reading versions from. */
export function hasInstalledTree(rootDir: string, appDir: string): boolean {
  return existsSync(join(rootDir, appDir, 'node_modules'));
}
