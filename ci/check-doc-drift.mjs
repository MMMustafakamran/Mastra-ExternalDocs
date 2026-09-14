import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const MANIFEST_PATH = path.join(ROOT_DIR, 'doc-snapshot', 'manifest.json');
const PAGES_DIR = path.join(ROOT_DIR, 'doc-snapshot', 'pages');

const CONCURRENCY = 6;
const TIMEOUT_MS = 10000;

function sha256(text) {
  return crypto.createHash('sha256').update(normalizeText(text), 'utf8').digest('hex');
}

function normalizeText(raw) {
  return raw.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
}

function categorizeSeverity(oldText, newText) {
  const oldCodeFences = (oldText.match(/```/g) || []).length;
  const newCodeFences = (newText.match(/```/g) || []).length;
  if (oldCodeFences !== newCodeFences) return 'HIGH (Code fence count changed)';

  const oldCodeLines = oldText.split('\n').filter((l) => l.startsWith('    ') || l.startsWith('```'));
  const newCodeLines = newText.split('\n').filter((l) => l.startsWith('    ') || l.startsWith('```'));
  if (oldCodeLines.join('\n') !== newCodeLines.join('\n')) {
    return 'HIGH (Code block content changed)';
  }

  const oldHeadings = oldText.split('\n').filter((l) => l.startsWith('#')).join('\n');
  const newHeadings = newText.split('\n').filter((l) => l.startsWith('#')).join('\n');
  if (oldHeadings !== newHeadings) {
    return 'MEDIUM (Headings / Structure changed)';
  }

  return 'LOW (Prose / text phrasing updated)';
}

/**
 * In these external-docs repos a manifest key is the vendor's own absolute URL,
 * not a path under docs.copilotkit.ai. Build the endpoint from the key itself,
 * falling back to `docsRoot` for the path-style keys the sibling repos use.
 */
function pageUrl(docPath, docsRoot) {
  const base = /^https?:\/\//.test(docPath)
    ? docPath
    : `${String(docsRoot || '').replace(/\/+$/, '')}${docPath}`;
  return base.replace(/\/+$/, '');
}

function decodeEntities(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&#x27;/gi, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&');
}

function stripTags(s) {
  return decodeEntities(s.replace(/<[^>]+>/g, ''));
}

const normBlock = (s) => s.replace(/\s+/g, ' ').trim();
const normHeading = (s) => s.replace(/[#¶`*]/g, '').trim();

/** Code blocks + headings of a rendered page — what a finding actually rests on. */
function htmlSignature(html) {
  const article = html.match(/<article[^>]*class="[^"]*md-content__inner[^"]*"[^>]*>([\s\S]*?)<\/article>/)
    || html.match(/<main[^>]*>([\s\S]*?)<\/main>/);
  const body = article ? article[1] : html;
  const codes = [...body.matchAll(/<pre[^>]*>[\s\S]*?<code[^>]*>([\s\S]*?)<\/code>[\s\S]*?<\/pre>/g)]
    .map((m) => normBlock(stripTags(m[1])))
    .filter(Boolean);
  const headings = [...body.matchAll(/<h([2-4])[^>]*>([\s\S]*?)<\/h\1>/g)]
    .map((m) => normHeading(stripTags(m[2])))
    .filter(Boolean);
  return { codes, headings };
}

/** The same signature, read out of a snapshot markdown file. */
function markdownSignature(text) {
  const codes = [];
  const headings = [];
  let inFence = false;
  let buf = [];
  for (const line of normalizeText(text).split('\n')) {
    if (/^\s*```/.test(line)) {
      if (inFence) {
        const b = normBlock(buf.join('\n'));
        if (b) codes.push(b);
        buf = [];
      }
      inFence = !inFence;
      continue;
    }
    if (inFence) buf.push(line);
    else if (/^#{2,4} /.test(line)) headings.push(normHeading(line.replace(/^#{2,4} /, '')));
  }
  return { codes, headings };
}

/**
 * Pages with no markdown endpoint (mkdocs, for one) are compared on their
 * rendered code blocks and headings instead. A prose-only edit is invisible to
 * this mode, and it says so in the severity string rather than claiming "ok".
 */
async function checkPageAsHtml(docPath, pageMeta, docsRoot) {
  const url = pageUrl(docPath, docsRoot) + '/';
  const res = await fetch(url, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { 'User-Agent': 'CopilotKit-DocDrift-Detector/1.0' },
  });
  if (!res.ok) {
    return { docPath, file: pageMeta.file, drifted: res.status === 404, status: String(res.status),
      error: `HTTP ${res.status} ${res.statusText}`, mode: 'html',
      severity: res.status === 404 ? 'HIGH (Page 404 / Removed)' : undefined };
  }
  const live = htmlSignature(await res.text());
  let snap = { codes: [], headings: [] };
  try {
    snap = markdownSignature(await fs.readFile(path.join(PAGES_DIR, pageMeta.file), 'utf8'));
  } catch {
    return { docPath, file: pageMeta.file, drifted: true, mode: 'html', status: 'no-snapshot',
      severity: 'HIGH (No local snapshot to compare against)' };
  }
  const liveCodes = new Set(live.codes);
  const snapCodes = new Set(snap.codes);
  const codeAdded = live.codes.filter((c) => !snapCodes.has(c));
  const codeRemoved = snap.codes.filter((c) => !liveCodes.has(c));
  const headAdded = live.headings.filter((h) => !snap.headings.includes(h));
  const headRemoved = snap.headings.filter((h) => !live.headings.includes(h));
  if (!codeAdded.length && !codeRemoved.length && !headAdded.length && !headRemoved.length) {
    return { docPath, file: pageMeta.file, drifted: false, status: 'ok-html', mode: 'html' };
  }
  return {
    docPath,
    file: pageMeta.file,
    drifted: true,
    mode: 'html',
    status: 'drifted',
    severity: codeAdded.length || codeRemoved.length
      ? `HIGH (Code block content changed: +${codeAdded.length} / -${codeRemoved.length})`
      : `MEDIUM (Headings / Structure changed: +${headAdded.length} / -${headRemoved.length})`,
    detail: [
      ...headAdded.map((h) => `   + heading only live    : ${h}`),
      ...headRemoved.map((h) => `   - heading only snapshot: ${h}`),
      ...codeAdded.slice(0, 5).map((c) => `   + code only live       : ${c.slice(0, 100)}`),
      ...codeRemoved.slice(0, 5).map((c) => `   - code only snapshot   : ${c.slice(0, 100)}`),
    ],
  };
}

async function checkPage(docPath, pageMeta, docsRoot) {
  const url = `${pageUrl(docPath, docsRoot)}.md`;
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        'User-Agent': 'CopilotKit-DocDrift-Detector/1.0',
        Accept: 'text/markdown, text/plain, */*',
      },
    });

    // A 404 on `.md` is not a removed page: docs.ag2.ai publishes no markdown
    // endpoint at all. The rendered page decides whether it is really gone.
    if (res.status === 404) {
      return await checkPageAsHtml(docPath, pageMeta, docsRoot);
    }

    if (!res.ok) {
      return {
        docPath,
        file: pageMeta.file,
        status: String(res.status),
        error: `HTTP ${res.status} ${res.statusText}`,
        drifted: false,
      };
    }

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('text/markdown') && !contentType.includes('text/plain')) {
      // Soft 404, SPA redirect, or a docs site that simply serves no markdown.
      // Compare the rendered page instead of reporting nothing.
      return await checkPageAsHtml(docPath, pageMeta, docsRoot);
    }

    const fetchedText = await res.text();
    const fetchedHash = sha256(fetchedText);

    if (fetchedHash === pageMeta.sha256) {
      return { docPath, file: pageMeta.file, drifted: false, status: 'ok' };
    }

    // Hash differs - determine severity
    let oldContent = '';
    try {
      oldContent = await fs.readFile(path.join(PAGES_DIR, pageMeta.file), 'utf8');
    } catch {
      // no previous file
    }

    const severity = categorizeSeverity(oldContent, fetchedText);
    return {
      docPath,
      file: pageMeta.file,
      drifted: true,
      severity,
      oldHash: pageMeta.sha256.slice(0, 8),
      newHash: fetchedHash.slice(0, 8),
      fullHash: fetchedHash,
      fetchedText,
      bytes: Buffer.byteLength(fetchedText, 'utf8'),
      lines: fetchedText.split('\n').length,
      status: 'drifted',
    };
  } catch (err) {
    return {
      docPath,
      file: pageMeta.file,
      drifted: false,
      status: 'fetch-error',
      error: err.message,
    };
  }
}

export async function applyDocUpdates(driftedPages) {
  const manifestRaw = await fs.readFile(MANIFEST_PATH, 'utf8');
  const manifest = JSON.parse(manifestRaw);
  let updatedCount = 0;

  for (const p of driftedPages) {
    if (p.fetchedText && p.file) {
      const filePath = path.join(PAGES_DIR, p.file);
      await fs.writeFile(filePath, p.fetchedText, 'utf8');

      if (manifest.pages[p.docPath]) {
        manifest.pages[p.docPath].sha256 = p.fullHash;
        manifest.pages[p.docPath].bytes = p.bytes;
        manifest.pages[p.docPath].lines = p.lines;
        manifest.pages[p.docPath].date = new Date().toUTCString();
      }
      updatedCount++;
      console.log(` ✅ Updated ${p.file} (${p.docPath})`);
    }
  }

  manifest.syncedAt = new Date().toISOString();
  await fs.writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  console.log(`\n💾 Successfully updated ${updatedCount} markdown file(s) and saved doc-snapshot/manifest.json.`);
  return updatedCount;
}

/**
 * The gap the hash check cannot see: pages that appeared upstream.
 *
 * Every URL the sitemap lists under this repo's docs root is either tracked
 * (a manifest page), already acknowledged (`sitemap.knownUnmapped`, seeded by
 * /doc-sync), or new. New is drift -- a page nobody has read, with no route,
 * no recorder entry and no diff. Ten of them were missed on 2026-09-04 because
 * only the in-app /doc-sync action made this comparison and nothing in CI ran
 * it. The same logic as `buildSitemapFinding` in
 * frontend/src/lib/doc-sync/actions.ts, without the Next.js import chain.
 *
 * `lastmod` is ignored on purpose: it is the site's build stamp, not a
 * per-page modification time.
 */
let _manifestCache;
function manifestRoutes(docPath) {
  return (_manifestCache?.pages?.[docPath]?.routes ?? []).join(', ') || '-';
}

/**
 * `/sitemap.xml` is a sitemap *index* on some sites (mastra.ai is one): its
 * <loc>s are other sitemaps, not pages. Reading it flat reports nine sitemap
 * files as "new upstream pages" and no real page at all.
 */
async function fetchSitemapLocs(url, depth = 0) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { 'User-Agent': 'CopilotKit-DocDrift-Detector/1.0' },
  });
  if (!res.ok) throw new Error(`sitemap HTTP ${res.status}`);
  const xml = await res.text();
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
  if (!/<sitemapindex/i.test(xml) || depth >= 2) return locs;

  const out = [];
  for (const child of locs.slice(0, 20)) {
    try {
      out.push(...(await fetchSitemapLocs(child, depth + 1)));
    } catch {
      // one unreadable child sitemap must not blind the whole check
    }
  }
  return out;
}

export async function checkSitemapGaps(manifest) {
  _manifestCache = manifest;
  const root = new URL(manifest.docsRoot);
  const prefix = `${root.origin}${root.pathname.replace(/\/+$/, '')}/`;
  // Trailing slashes are a rendering choice, not identity: docs.ag2.ai lists
  // every page with one and the manifest keys carry none.
  const canon = (u) => u.replace(/\/+$/, '');

  let locs;
  try {
    locs = await fetchSitemapLocs(`${root.origin}/sitemap.xml`);
  } catch (err) {
    return { error: err.message, newUnmapped: [], missingFromSitemap: [] };
  }

  const upstream = locs
    // The section root itself is listed without the trailing slash.
    .filter((u) => u.startsWith(prefix) || canon(u) === canon(prefix))
    .map(canon);

  // Manifest keys here are already absolute; only the sibling repos' path-style
  // keys need the origin prepended.
  const abs = (docPath) => canon(/^https?:\/\//.test(docPath) ? docPath : `${root.origin}${docPath}`);

  // One page, two published URLs: mastra.ai serves the CopilotKit guide at both
  // /guides/build-your-ui/copilotkit/overview and /integrations/agentic-ui/
  // copilotkit, and lists only the second in its sitemap. Without the alias the
  // tracked page reads as removed on every run.
  const aliasesOf = (docPath) => {
    const a = manifest.sitemap?.aliases?.[docPath];
    return (Array.isArray(a) ? a : a ? [a] : []).map(abs);
  };
  const tracked = Object.keys(manifest.pages).map((docPath) => ({
    docPath,
    urls: [abs(docPath), ...aliasesOf(docPath)],
  }));
  const covered = new Set(tracked.flatMap((t) => t.urls));
  const known = new Set((manifest.sitemap?.knownUnmapped ?? []).map(canon));
  const upstreamSet = new Set(upstream);

  return {
    urlsUnderRoot: upstream.length,
    newUnmapped: upstream.filter((u) => !covered.has(u) && !known.has(u)),
    // Tracked but no longer listed. Alone this is a hint, not a removal --
    // the per-page 404 check above is the other half of that verdict. A page
    // listed under any one of its URLs is listed.
    missingFromSitemap: tracked
      .filter((t) => !t.urls.some((u) => upstreamSet.has(u)))
      .map((t) => abs(t.docPath)),
  };
}

export async function checkAllDocDrift() {
  const manifestRaw = await fs.readFile(MANIFEST_PATH, 'utf8');
  const manifest = JSON.parse(manifestRaw);
  const entries = Object.entries(manifest.pages);

  console.log(`\n🔍 Checking doc drift across ${entries.length} tracked pages against live docs...`);

  const results = [];
  const queue = [...entries];

  async function worker() {
    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) break;
      const [docPath, pageMeta] = item;
      const res = await checkPage(docPath, pageMeta, manifest.docsRoot);
      results.push(res);
      process.stdout.write(res.drifted ? '!' : res.error ? '?' : '.');
    }
  }

  const workers = Array.from({ length: CONCURRENCY }, () => worker());
  await Promise.all(workers);
  process.stdout.write('\n\n');

  const driftedPages = results.filter((r) => r.drifted);
  const errors = results.filter((r) => r.error);

  const sitemap = await checkSitemapGaps(manifest);
  if (sitemap.error) {
    console.log(`ℹ️  Sitemap unreachable (${sitemap.error}); new upstream pages NOT checked this run.`);
  } else {
    console.log(
      `🗺️  Sitemap: ${sitemap.urlsUnderRoot} URLs under ${manifest.docsRoot}, ` +
        `${sitemap.newUnmapped.length} new, ${sitemap.missingFromSitemap.length} tracked page(s) no longer listed.`,
    );
    for (const u of sitemap.missingFromSitemap) console.log(`   · not in sitemap: ${u}`);
  }

  const htmlMode = results.filter((r) => r.mode === 'html').length;
  if (htmlMode > 0) {
    console.log(
      `📄 ${htmlMode}/${results.length} page(s) have no markdown endpoint and were compared on ` +
        `rendered code blocks + headings. Prose-only edits are invisible in that mode.`,
    );
  }

  return {
    total: entries.length,
    checked: results.length,
    docsRoot: manifest.docsRoot,
    drifted: driftedPages.length > 0 || sitemap.newUnmapped.length > 0,
    driftedPages,
    sitemap,
    errors,
  };
}

// Standalone execution
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const autoUpdate = args.includes('--update') || args.includes('--sync') || args.includes('-u');

  // Scope, said out loud on every run. Tracked pages are hashed; the sitemap
  // is compared for pages that appeared upstream (new = drift, exit 2).
  // Renames and removals are only hinted -- a tracked page that 404s AND has
  // left the sitemap is reported, but nothing here decides it was renamed.
  process.on('exit', () => {
    console.log(
      '\nℹ️  Scope: tracked pages hashed + sitemap compared for new pages.\n' +
        '   A page that 404s and has left the sitemap is listed; whether it was\n' +
        '   renamed is a judgement for /doc-sync and the reader.',
    );
  });

  const result = await checkAllDocDrift();
  if (result.sitemap.newUnmapped.length > 0) {
    console.log('🆕 [NEW UPSTREAM PAGES] Listed in the sitemap, tracked nowhere in this repo:');
    for (const u of result.sitemap.newUnmapped) console.log(` • ${u}`);
    console.log('   Snapshot them from http://localhost:3000/doc-sync, or add them to\n' +
      '   sitemap.knownUnmapped in doc-snapshot/manifest.json to acknowledge them.\n');
  }
  const gone = result.driftedPages.filter((p) => p.status === '404' &&
    result.sitemap.missingFromSitemap?.includes(
      (/^https?:\/\//.test(p.docPath) ? p.docPath : `${new URL(result.docsRoot).origin}${p.docPath}`)
        .replace(/\/+$/, '')));
  if (gone.length > 0) {
    console.log('🗑️  [REMOVED OR RENAMED] 404 on the markdown endpoint AND gone from the sitemap:');
    for (const p of gone) console.log(` • ${p.docPath}  (route(s): ${manifestRoutes(p.docPath)})`);
    console.log('   The route(s) still serve and the recorder still passes them. Decide, then delete.\n');
  }

  if (result.driftedPages.length > 0) {
    console.log('🚨 [DOC DRIFT DETECTED] The following live documentation pages have changed:');
    console.log('───────────────────────────────────────────────────────────────────────────');
    for (const p of result.driftedPages) {
      console.log(` • [${p.severity}] ${p.docPath}`);
      if (p.oldHash && p.newHash) {
        console.log(`   Hash: ${p.oldHash} ➔ ${p.newHash} (${p.file})`);
      }
      for (const line of p.detail ?? []) console.log(line);
    }
    console.log('───────────────────────────────────────────────────────────────────────────');

    if (autoUpdate) {
      console.log('\n🔄 Applying changes to local markdown snapshot files (--update flag)...');
      await applyDocUpdates(result.driftedPages);
      console.log('✨ Local markdown files are now in sync with live docs.');
      process.exit(0);
    } else {
      if (process.stdin.isTTY) {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        const answer = await rl.question('\n❓ Would you like to update and overwrite the local markdown files now? (y/N): ');
        rl.close();

        if (answer.trim().toLowerCase() === 'y' || answer.trim().toLowerCase() === 'yes') {
          console.log('\n🔄 Applying changes to local markdown files...');
          await applyDocUpdates(result.driftedPages);
          console.log('✨ Local markdown files are now in sync with live docs.');
          process.exit(0);
        }
      }

      console.log('\n👉 Local markdown files NOT modified. Pass `--update` or visit http://localhost:3000/doc-sync to sync.');
      process.exit(2);
    }
  }
  if (result.driftedPages.length === 0) {
    if (result.sitemap.newUnmapped.length > 0) process.exit(2);
    // A page nobody could fetch is a page nobody checked. Reporting "no drift"
    // for it is how this gate passed green for four pages it never read.
    if (result.errors.length > 0) {
      console.log(`🚫 [NOT CHECKED] ${result.errors.length} of ${result.total} page(s) could not be read:`);
      for (const e of result.errors) console.log(` • ${e.docPath} — ${e.error}`);
      console.log('   Nothing above is a verdict on those pages.');
      process.exit(2);
    }
    console.log(`✅ [NO DOC DRIFT] All ${result.total} documentation pages match the local snapshot.`);
    process.exit(0);
  }
}
