/**
 * RUN_REPORT.md / RUN_REPORT.json — the artifact a run is judged by.
 *
 * The markdown is appended to the GitHub step summary by the workflow, so it
 * has to read well on its own without the job log next to it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { FRONTEND_PORT, BACKEND_PORT, FRONTEND_DIR, BACKEND_DIR, VIDEOS_DIR } from './config.mjs';

/**
 * What actually ran -- not what package.json asks for.
 *
 * ci/automate.mjs drops the lockfile by default, so a run deliberately tests
 * the newest versions the declared ranges allow. Reading `pkg.dependencies`
 * therefore reported the FLOOR of a range rather than the version under test:
 * a run against @copilotkit/react-core 1.69.3 reported "^1.69.2". That made
 * the report misleading about the one thing the run exists to discover, and
 * the disagreement only surfaced when a separate resolved-version report was
 * put next to it.
 *
 * Read the installed tree instead, and keep the declared range alongside when
 * the two differ, so a range bump is still visible.
 */
function resolveVersion(dir, pkg, name) {
  const declared = pkg.dependencies?.[name] ?? pkg.devDependencies?.[name];
  let installed;
  try {
    const manifest = path.join(dir, 'node_modules', ...name.split('/'), 'package.json');
    installed = JSON.parse(fs.readFileSync(manifest, 'utf8')).version;
  } catch {
    // Not installed: a report written before install, or after a failed one.
  }
  if (!declared && !installed) return 'n/a';
  if (!installed) return `${declared} (not installed)`;
  if (!declared) return installed;
  return declared === installed ? installed : `${installed} (declared ${declared})`;
}

/**
 * Backend versions, read from uv.lock rather than the pyproject specifiers.
 *
 * The same defect the frontend map had: pyproject declares floors
 * (`agno>=2.8.7`) while ci/automate.mjs runs `uv sync --upgrade`, which
 * resolves past them. Reporting the specifier therefore named a version the
 * run had deliberately moved off -- and named it "Version".
 *
 * That same `uv sync --upgrade` rewrites uv.lock, so by the time this report
 * is written the lock names what actually ran. That makes it the backend's
 * equivalent of reading node_modules.
 */
function lockedVersions(dir) {
  const locked = new Map();
  try {
    const lock = fs.readFileSync(path.join(dir, 'uv.lock'), 'utf8');
    // uv.lock is generated TOML and every entry is a [[package]] table whose
    // first two keys are name and version, in that order. A regex reads that
    // reliably and saves taking on a TOML parser for four lines of work.
    const entry = /\[\[package\]\]\s*\nname = "([^"]+)"\s*\nversion = "([^"]+)"/g;
    for (const m of lock.matchAll(entry)) locked.set(m[1], m[2]);
  } catch {
    // No lock file: uv sync never ran, or this backend is not Python.
  }
  return locked;
}

/**
 * Derived from pyproject's own dependency list rather than a hardcoded set of
 * interesting names, so adding a dependency cannot silently leave it out of
 * every future report.
 */
function backendVersions(dir) {
  const out = {};
  let pyproject;
  try {
    pyproject = fs.readFileSync(path.join(dir, 'pyproject.toml'), 'utf8');
  } catch {
    return out;
  }

  out['requires-python'] = pyproject.match(/requires-python\s*=\s*"([^"]+)"/)?.[1] || 'n/a';

  const locked = lockedVersions(dir);
  const block = pyproject.match(/^dependencies\s*=\s*\[([\s\S]*?)^\]/m)?.[1] ?? '';

  // Requiring the leading quote skips the comment lines inside the array. The
  // optional group after the name drops extras -- "sqlalchemy[asyncio]" is
  // locked under plain "sqlalchemy".
  for (const m of block.matchAll(/^\s*"([A-Za-z0-9._-]+)(?:\[[^\]]*\])?\s*([^"]*)"/gm)) {
    const [, name, spec] = m;
    const declared = spec.trim();
    const installed = locked.get(name.toLowerCase());
    if (installed) {
      out[name] = declared ? `${installed} (declared ${declared})` : installed;
    } else {
      out[name] = declared ? `${declared} (not locked)` : 'n/a';
    }
  }
  return out;
}

export function getPackageVersions() {
  const versions = { frontend: {}, backend: {} };
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(FRONTEND_DIR, 'package.json'), 'utf8'));
    versions.frontend = {
      '@copilotkit/react-core': resolveVersion(FRONTEND_DIR, pkg, '@copilotkit/react-core'),
      '@copilotkit/runtime': resolveVersion(FRONTEND_DIR, pkg, '@copilotkit/runtime'),
      '@ag-ui/client': resolveVersion(FRONTEND_DIR, pkg, '@ag-ui/client'),
      next: resolveVersion(FRONTEND_DIR, pkg, 'next'),
      react: resolveVersion(FRONTEND_DIR, pkg, 'react'),
    };
  } catch {
    // ignore
  }
  try {
    versions.backend = backendVersions(BACKEND_DIR);
  } catch {
    // ignore
  }
  return versions;
}

function sizeOf(file) {
  try {
    return `${(fs.statSync(file).size / (1024 * 1024)).toFixed(2)} MB`;
  } catch {
    return 'n/a';
  }
}

/**
 * What this run recorded, from the recorder's own results file.
 *
 * This used to list every `.webm` in the folder and call each one "Recorded",
 * so a run of one page reported five videos, four of them days old. The
 * recorder now writes `RECORD_RESULTS.json` per run; that is the source. The
 * directory listing remains only as a fallback for a run that died before the
 * recorder could write it, and is labelled as such.
 */
function listVideos() {
  const resultsFile = path.join(VIDEOS_DIR, 'RECORD_RESULTS.json');
  try {
    const run = JSON.parse(fs.readFileSync(resultsFile, 'utf8'));
    return {
      fromRun: true,
      timestamp: run.timestamp,
      videos: run.results.map((r) => ({
        id: r.id,
        name: r.name,
        filename: r.filename || '',
        status: !r.success ? 'failed' : r.warnings?.length ? 'pass-with-notes' : 'pass',
        notes: [...(r.warnings ?? []), ...(r.error ? [r.error] : [])],
        sizeMB: r.filename ? sizeOf(path.join(VIDEOS_DIR, r.filename)) : 'n/a',
        durationSec: r.durationSec,
      })),
    };
  } catch {
    // No results file: fall back to what is on disk, and say so.
  }

  const videos = [];
  try {
    for (const f of fs.readdirSync(VIDEOS_DIR)) {
      if (!f.endsWith('.webm') || f.startsWith('temp_')) continue;
      videos.push({ filename: f, status: 'on-disk', notes: [], sizeMB: sizeOf(path.join(VIDEOS_DIR, f)) });
    }
  } catch {
    // ignore
  }
  return { fromRun: false, videos };
}

const STATUS_LABEL = {
  pass: '✅ Recorded',
  'pass-with-notes': '⚠️ Recorded with notes',
  failed: '❌ Failed',
  'on-disk': '📁 On disk (no results file for this run)',
};

export function generateReport(data) {
  fs.mkdirSync(VIDEOS_DIR, { recursive: true });

  const { videos, fromRun } = listVideos();
  const report = {
    timestamp: new Date().toISOString(),
    status: data.success ? 'SUCCESS' : 'FAILED',
    args: data.args?.length > 0 ? data.args.join(' ') : 'all',
    refreshedDeps: Boolean(data.refreshed),
    docDrift: {
      checkedPages: data.driftResult?.total || 0,
      driftDetected: data.driftResult?.drifted || false,
      driftedPages: data.driftResult?.driftedPages || [],
    },
    packages: getPackageVersions(),
    healthChecks: data.health || {},
    videos,
    error: data.error || null,
  };

  fs.writeFileSync(
    path.join(VIDEOS_DIR, 'RUN_REPORT.json'),
    JSON.stringify(report, null, 2),
    'utf8',
  );

  const lines = [];
  lines.push('# 📊 CopilotKit Automation & Recording Report\n');
  lines.push(`- **Status:** ${report.status === 'SUCCESS' ? '✅ **SUCCESS**' : '❌ **FAILED**'}`);
  lines.push(`- **Generated At:** \`${report.timestamp}\``);
  lines.push(`- **Execution Mode:** \`${report.args}\``);
  lines.push(`- **Dependencies:** \`${report.refreshedDeps ? 'Re-resolved (--refresh)' : 'From lockfile'}\`\n`);

  lines.push('## 1. 🔍 Doc Drift Check');
  if (report.docDrift.driftDetected) {
    lines.push(`⚠️ **Drift Detected** on ${report.docDrift.driftedPages.length} page(s):`);
    for (const p of report.docDrift.driftedPages) {
      lines.push(`- **[${p.severity}]** \`${p.docPath}\` (${p.file})`);
    }
  } else {
    lines.push(
      `✅ **No Doc Drift Detected:** All ${report.docDrift.checkedPages} pages match \`doc-snapshot/\`.`,
    );
  }
  lines.push('');

  lines.push('## 2. 📦 Package Versions');
  lines.push('### Frontend (`frontend/package.json`):');
  for (const [k, v] of Object.entries(report.packages.frontend)) {
    lines.push(`- **\`${k}\`**: \`${v}\``);
  }
  lines.push('\n### Backend (`backend/pyproject.toml`):');
  for (const [k, v] of Object.entries(report.packages.backend)) {
    lines.push(`- **\`${k}\`**: \`${v}\``);
  }
  lines.push('');

  lines.push('## 3. 🚀 Services & Health Checks');
  lines.push(
    `- **Backend Agent (\`:${BACKEND_PORT}/health\`):** ${
      report.healthChecks.backend ? `✅ Healthy (${report.healthChecks.backend}s)` : '❌ Offline'
    }`,
  );
  lines.push(
    `- **Frontend Next.js (\`:${FRONTEND_PORT}\`):** ${
      report.healthChecks.frontend ? `✅ Healthy (${report.healthChecks.frontend}s)` : '❌ Offline'
    }\n`,
  );

  lines.push('## 4. 🎬 Generated Demo Videos');
  if (videos.length > 0) {
    if (!fromRun) {
      lines.push('*The recorder wrote no results file for this run; listing what is on disk instead.*\n');
    }
    lines.push('| Video File | Status | File Size | Notes |');
    lines.push('|---|---|---|---|');
    for (const v of videos) {
      const notes = v.notes.map((n) => n.replace(/\|/g, '\\|').replace(/\s+/g, ' ')).join('<br>');
      lines.push(`| \`${v.filename || '(no video)'}\` | ${STATUS_LABEL[v.status] ?? v.status} | ${v.sizeMB} | ${notes} |`);
    }
  } else {
    lines.push('*No videos recorded in this run.*');
  }
  lines.push('');

  if (report.error) {
    lines.push('## ⚠️ Failure Details');
    lines.push(`\`\`\`\n${report.error}\n\`\`\`\n`);
    lines.push('Server logs for this run are attached under `videos/logs/`.');
  }

  fs.writeFileSync(path.join(VIDEOS_DIR, 'RUN_REPORT.md'), lines.join('\n'), 'utf8');
  console.log(`\n📄 Execution report saved to: ${path.join(VIDEOS_DIR, 'RUN_REPORT.md')}`);
}
