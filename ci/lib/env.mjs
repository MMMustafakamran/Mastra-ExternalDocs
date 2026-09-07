/**
 * Load the repo's .env files into process.env.
 *
 * The preflight checks need the same credentials the backend will use, and the
 * backend reads them from files rather than the shell. Precedence copies
 * `backend/main.py` exactly:
 *
 *   already in process.env  >  backend/.env  >  repo-root .env
 *
 * In CI nothing is loaded from files — the workflow exports real values, and
 * those win because they are already set.
 *
 * Deliberately minimal: enough .env syntax for this repo's files, no dependency
 * at the workspace root.
 */
import fs from 'node:fs';
import path from 'node:path';
import { BACKEND_DIR, ROOT_DIR } from './config.mjs';

function parseEnvFile(filePath) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch {
    return {};
  }

  const out = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;

    const key = trimmed.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;

    let value = trimmed.slice(eq + 1).trim();
    // Strip matching quotes; leave inner content untouched.
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
      (value.startsWith("'") && value.endsWith("'") && value.length > 1)
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/** Returns the list of files that actually contributed a value. */
export function loadEnvFiles() {
  const loaded = [];
  for (const file of [path.join(BACKEND_DIR, '.env'), path.join(ROOT_DIR, '.env')]) {
    const parsed = parseEnvFile(file);
    let applied = 0;
    for (const [k, v] of Object.entries(parsed)) {
      if (process.env[k] === undefined) {
        process.env[k] = v;
        applied += 1;
      }
    }
    if (applied > 0) loaded.push(path.relative(ROOT_DIR, file));
  }
  return loaded;
}

/**
 * Trim the credentials the job inherited.
 *
 * Values from `.env` are trimmed as they are parsed; values injected by CI are
 * not, and a GitHub secret pasted with a trailing newline keeps it. That is not
 * a cosmetic difference. Node's fetch normalises header values, so the
 * credential preflight passed and the runtime worked — while Python's httpx
 * refused the same key with `Illegal header value`, which the OpenAI SDK
 * reports as the far less helpful "Connection error". The agent looked
 * unreachable when the key simply had a newline on the end.
 *
 * Trimming here fixes the run and leaves the secret worth fixing at the source;
 * the names printed say which ones to re-paste.
 */
export function trimInheritedCredentials() {
  const trimmed = [];
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value !== 'string') continue;
    if (!/_(API_KEY|ENDPOINT|MODEL_ID|TOKEN|URL)$/.test(key)) continue;
    const clean = value.trim();
    if (clean !== value) {
      process.env[key] = clean;
      trimmed.push(key);
    }
  }
  return trimmed;
}
