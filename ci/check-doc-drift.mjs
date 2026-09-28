import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

/**
 * Exit: 0 clean, 2 drift, 3 something could not be read (not a verdict).
 *
 * Pages with a `.md` endpoint are hashed. Pages without one (docs.ag2.ai) are
 * compared exactly and in order against doc-snapshot/signatures/<file>.json.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const MANIFEST_PATH = path.join(ROOT_DIR, 'doc-snapshot', 'manifest.json');
const PAGES_DIR = path.join(ROOT_DIR, 'doc-snapshot', 'pages');
const SIGNATURES_DIR = path.join(ROOT_DIR, 'doc-snapshot', 'signatures');

const CONCURRENCY = 6;
const TIMEOUT_MS = 10000;
const RETRY_DELAY_MS = 2000;
const UA = 'CopilotKit-DocDrift-Detector/1.0';

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

/** Manifest keys are absolute URLs here; path-style keys fall back to `docsRoot`. */
function pageUrl(docPath, docsRoot) {
  const base = /^https?:\/\//.test(docPath)
    ? docPath
    : `${String(docsRoot || '').replace(/\/+$/, '')}${docPath}`;
  return base.replace(/\/+$/, '');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Retries once on an error or 5xx/429. Does not follow redirects: a 3xx is drift. */
async function fetchPage(url, headers = {}) {
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await sleep(RETRY_DELAY_MS);
    try {
      const res = await fetch(url, {
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { 'User-Agent': UA, ...headers },
      });
      if (res.status >= 500 || res.status === 429) {
        lastErr = new Error(`HTTP ${res.status} ${res.statusText}`);
        continue;
      }
      return res;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

function movedResult(docPath, pageMeta, res, url) {
  const loc = res.headers.get('location') || '';
  const target = loc ? new URL(loc, url).href : '(no Location header)';
  return {
    docPath,
    file: pageMeta.file,
    drifted: true,
    status: 'moved',
    severity: `HIGH (Page moved: ${res.status} -> ${target})`,
    detail: [
      `   The tracked URL now redirects. Re-key this page in doc-snapshot/manifest.json`,
      `   to the new URL (and the recorder's doc URL with it); --update cannot decide that.`,
    ],
  };
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
const normHeading = (s) => s.replace(/[#¶`*]/g, '').replace(/\s+/g, ' ').trim();

/** Keeps indentation; normalises only line endings and trailing spaces. */
const exactBlock = (s) =>
  normalizeText(s)
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .join('\n')
    .replace(/^\n+|\n+$/g, '');

/** Code blocks, headings and inline code of a rendered page, in page order. */
function htmlSignature(html) {
  const article = html.match(/<article[^>]*class="[^"]*md-content__inner[^"]*"[^>]*>([\s\S]*?)<\/article>/)
    || html.match(/<main[^>]*>([\s\S]*?)<\/main>/);
  const body = article ? article[1] : html;
  const preRe = /<pre[^>]*>[\s\S]*?<code[^>]*>([\s\S]*?)<\/code>[\s\S]*?<\/pre>/g;
  const codes = [...body.matchAll(preRe)]
    .map((m) => exactBlock(stripTags(m[1])))
    .filter(Boolean);
  const headings = [...body.matchAll(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/g)]
    .map((m) => `h${m[1]} ${normHeading(stripTags(m[2]))}`)
    .filter((h) => h.length > 3);
  const inline = [...body.replace(preRe, '').matchAll(/<code[^>]*>([\s\S]*?)<\/code>/g)]
    .map((m) => normBlock(stripTags(m[1])))
    .filter(Boolean);
  return { codes, headings, inline };
}

/** Loose signature of a snapshot .md; only used before a page's first pin. */
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

const signatureFile = (pageMeta) => pageMeta.file.replace(/\.md$/, '') + '.json';

/** First differing line of two blocks. */
function firstLineDiff(a, b) {
  const al = a.split('\n');
  const bl = b.split('\n');
  for (let i = 0; i < Math.max(al.length, bl.length); i++) {
    if (al[i] !== bl[i]) {
      return [`     line ${i + 1} snapshot: ${JSON.stringify(al[i] ?? '(none)').slice(0, 110)}`,
        `     line ${i + 1} live    : ${JSON.stringify(bl[i] ?? '(none)').slice(0, 110)}`];
    }
  }
  return [];
}

/** Ordered diff of two lists; empty when identical. */
function listDiff(label, snap, live, { showBlocks = false } = {}) {
  const out = [];
  if (snap.length !== live.length) out.push(`   ${label}: ${snap.length} in snapshot, ${live.length} live`);
  for (let i = 0; i < Math.max(snap.length, live.length); i++) {
    if (snap[i] === live[i]) continue;
    out.push(`   ${label} #${i + 1} differs`);
    if (showBlocks && snap[i] !== undefined && live[i] !== undefined) out.push(...firstLineDiff(snap[i], live[i]));
    else {
      out.push(`     snapshot: ${JSON.stringify(snap[i] ?? '(none)').slice(0, 110)}`);
      out.push(`     live    : ${JSON.stringify(live[i] ?? '(none)').slice(0, 110)}`);
    }
    if (out.length > 12) {
      out.push('     ...');
      break;
    }
  }
  return out;
}

/** For pages with no `.md` endpoint. Prose sentences are not compared. */
async function checkPageAsHtml(docPath, pageMeta, docsRoot) {
  const url = pageUrl(docPath, docsRoot) + '/';
  const res = await fetchPage(url);
  if (res.status >= 300 && res.status < 400) return movedResult(docPath, pageMeta, res, url);
  if (!res.ok) {
    return { docPath, file: pageMeta.file, drifted: res.status === 404, status: String(res.status),
      error: res.status === 404 ? undefined : `HTTP ${res.status} ${res.statusText}`, mode: 'html',
      severity: res.status === 404 ? 'HIGH (Page 404 / Removed)' : undefined };
  }
  const live = htmlSignature(await res.text());

  let pinned;
  try {
    pinned = JSON.parse(await fs.readFile(path.join(SIGNATURES_DIR, signatureFile(pageMeta)), 'utf8'));
  } catch {
    pinned = undefined;
  }

  if (!pinned) {
    // No pin yet: only pin a page that matches the markdown snapshot.
    let snap;
    try {
      snap = markdownSignature(await fs.readFile(path.join(PAGES_DIR, pageMeta.file), 'utf8'));
    } catch {
      return { docPath, file: pageMeta.file, drifted: true, mode: 'html', status: 'no-snapshot',
        severity: 'HIGH (No local snapshot to compare against)', signature: live };
    }
    const looseLive = { codes: live.codes.map(normBlock), headings: live.headings
      .filter((h) => /^h[2-4] /.test(h)).map((h) => h.slice(3)) };
    const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
    const matches = same(looseLive.codes, snap.codes) && same(looseLive.headings, snap.headings);
    return matches
      ? { docPath, file: pageMeta.file, drifted: false, mode: 'html', status: 'unpinned', signature: live }
      : { docPath, file: pageMeta.file, drifted: true, mode: 'html', status: 'drifted', signature: live,
        severity: 'HIGH (Differs from the markdown snapshot; no pinned signature yet)' };
  }

  const detail = [
    ...listDiff('code block', pinned.codes, live.codes, { showBlocks: true }),
    ...listDiff('heading', pinned.headings, live.headings),
    ...listDiff('inline code', pinned.inline ?? [], live.inline),
  ];
  if (detail.length === 0) {
    return { docPath, file: pageMeta.file, drifted: false, status: 'ok-html', mode: 'html' };
  }
  const codeChanged = JSON.stringify(pinned.codes) !== JSON.stringify(live.codes);
  const headChanged = JSON.stringify(pinned.headings) !== JSON.stringify(live.headings);
  return {
    docPath,
    file: pageMeta.file,
    drifted: true,
    mode: 'html',
    status: 'drifted',
    signature: live,
    severity: codeChanged
      ? 'HIGH (Code block content or order changed)'
      : headChanged
        ? 'MEDIUM (Headings / Structure changed)'
        : 'LOW (Inline code in prose changed)',
    detail,
  };
}

async function checkPage(docPath, pageMeta, docsRoot) {
  const url = `${pageUrl(docPath, docsRoot)}.md`;
  try {
    const res = await fetchPage(url, { Accept: 'text/markdown, text/plain, */*' });

    if (res.status >= 300 && res.status < 400) return movedResult(docPath, pageMeta, res, url);

    // No markdown endpoint (docs.ag2.ai): check the rendered page instead.
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
      // Not markdown: check the rendered page instead.
      return await checkPageAsHtml(docPath, pageMeta, docsRoot);
    }

    const fetchedText = await res.text();
    const fetchedHash = sha256(fetchedText);

    if (fetchedHash === pageMeta.sha256) {
      return { docPath, file: pageMeta.file, drifted: false, status: 'ok' };
    }

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

/** Repos that findings rest on (`watchedRepos`), compared by commit SHA. */
async function checkWatchedRepos(manifest) {
  const repos = manifest.watchedRepos ?? [];
  const headers = { Accept: 'application/vnd.github.sha' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const results = [];
  for (const w of repos) {
    const docPath = `https://github.com/${w.repo}`;
    try {
      const res = await fetchPage(`https://api.github.com/repos/${w.repo}/commits/${w.ref}`, headers);
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      const sha = (await res.text()).trim();
      if (sha === w.sha) {
        results.push({ docPath, kind: 'repo', drifted: false, status: 'ok' });
      } else {
        results.push({
          docPath, kind: 'repo', drifted: true, status: 'drifted', repo: w.repo, newSha: sha,
          severity: `HIGH (Watched repo has new commits on ${w.ref})`,
          oldHash: w.sha.slice(0, 12), newHash: sha.slice(0, 12),
          detail: [`   ${w.why}`, `   Diff: ${docPath}/compare/${w.sha.slice(0, 12)}...${sha.slice(0, 12)}`],
        });
      }
    } catch (err) {
      results.push({ docPath, kind: 'repo', drifted: false, status: 'fetch-error', error: err.message });
    }
  }
  return results;
}

export async function applyDocUpdates(results) {
  const manifestRaw = await fs.readFile(MANIFEST_PATH, 'utf8');
  const manifest = JSON.parse(manifestRaw);
  let updatedCount = 0;
  const unresolved = [];

  for (const p of results) {
    if (p.status === 'moved' || p.status === 'no-snapshot' || p.status === '404') {
      unresolved.push(p);
      continue;
    }
    if (p.kind === 'repo' && p.drifted) {
      const w = manifest.watchedRepos.find((r) => r.repo === p.repo);
      w.sha = p.newSha;
      w.pinnedAt = new Date().toISOString();
      updatedCount++;
      console.log(` ✅ Pinned ${p.repo} at ${p.newSha.slice(0, 12)}`);
    } else if (p.fetchedText && p.file) {
      await fs.writeFile(path.join(PAGES_DIR, p.file), p.fetchedText, 'utf8');
      if (manifest.pages[p.docPath]) {
        manifest.pages[p.docPath].sha256 = p.fullHash;
        manifest.pages[p.docPath].bytes = p.bytes;
        manifest.pages[p.docPath].lines = p.lines;
        manifest.pages[p.docPath].date = new Date().toUTCString();
      }
      updatedCount++;
      console.log(` ✅ Updated ${p.file} (${p.docPath})`);
    } else if (p.signature && p.file) {
      // Pins the signature only; pages/<file>.md is not regenerated.
      await fs.mkdir(SIGNATURES_DIR, { recursive: true });
      const file = signatureFile(p);
      await fs.writeFile(
        path.join(SIGNATURES_DIR, file),
        JSON.stringify({ url: p.docPath, pinnedAt: new Date().toISOString(), ...p.signature }, null, 2) + '\n',
        'utf8',
      );
      if (manifest.pages[p.docPath]) manifest.pages[p.docPath].signature = `signatures/${file}`;
      updatedCount++;
      console.log(` ✅ Pinned signatures/${file} (${p.docPath})`);
      if (p.drifted) console.log(`    ⚠️  pages/${p.file} (prose) was not regenerated -- update it by hand if the prose matters.`);
    }
  }

  manifest.syncedAt = new Date().toISOString();
  await fs.writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  console.log(`\n💾 Updated ${updatedCount} item(s) and saved doc-snapshot/manifest.json.`);
  for (const p of unresolved) {
    console.log(` ❗ Not applied, needs a human: ${p.docPath} -- ${p.severity}`);
  }
  return { updatedCount, unresolved };
}

/** New pages: sitemap URLs under docsRoot that are neither tracked nor in `knownUnmapped`. */
let _manifestCache;
function manifestRoutes(docPath) {
  return (_manifestCache?.pages?.[docPath]?.routes ?? []).join(', ') || '-';
}

/** Follows sitemap indexes (mastra.ai); unreadable children go in `failures`. */
async function fetchSitemapLocs(url, failures, depth = 0) {
  const res = await fetchPage(url);
  if (!res.ok) throw new Error(`sitemap HTTP ${res.status}`);
  const xml = await res.text();
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
  if (!/<sitemapindex/i.test(xml) || depth >= 2) return locs;

  const out = [];
  for (const child of locs.slice(0, 20)) {
    try {
      out.push(...(await fetchSitemapLocs(child, failures, depth + 1)));
    } catch (err) {
      failures.push(`${child} (${err.message})`);
    }
  }
  if (locs.length > 20) failures.push(`${locs.length - 20} child sitemap(s) beyond the first 20 not read`);
  return out;
}

export async function checkSitemapGaps(manifest) {
  _manifestCache = manifest;
  const root = new URL(manifest.docsRoot);
  const prefix = `${root.origin}${root.pathname.replace(/\/+$/, '')}/`;
  // docs.ag2.ai lists pages with a trailing slash; manifest keys have none.
  const canon = (u) => u.replace(/\/+$/, '');

  const failures = [];
  let locs;
  try {
    locs = await fetchSitemapLocs(`${root.origin}/sitemap.xml`, failures);
  } catch (err) {
    return { error: err.message, failures, newUnmapped: [], missingFromSitemap: [] };
  }

  const upstream = locs
    // The section root itself is listed without the trailing slash.
    .filter((u) => u.startsWith(prefix) || canon(u) === canon(prefix))
    .map(canon);

  const abs = (docPath) => canon(/^https?:\/\//.test(docPath) ? docPath : `${root.origin}${docPath}`);

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
    failures,
    newUnmapped: upstream.filter((u) => !covered.has(u) && !known.has(u)),
    // A hint only; the page check decides removal.
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

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  process.stdout.write('\n\n');

  const repoResults = await checkWatchedRepos(manifest);
  for (const r of repoResults) {
    console.log(`🔗 Watched repo ${r.docPath}: ${r.drifted ? `NEW COMMITS (${r.oldHash} -> ${r.newHash})` : r.error ? `unreadable (${r.error})` : 'unchanged'}`);
  }
  const all = [...results, ...repoResults];

  const sitemap = await checkSitemapGaps(manifest);
  if (sitemap.error) {
    console.log(`🚫 Sitemap unreachable (${sitemap.error}); new upstream pages NOT checked this run.`);
  } else {
    console.log(
      `🗺️  Sitemap: ${sitemap.urlsUnderRoot} URLs under ${manifest.docsRoot}, ` +
        `${sitemap.newUnmapped.length} new, ${sitemap.missingFromSitemap.length} tracked page(s) no longer listed.`,
    );
    for (const u of sitemap.missingFromSitemap) console.log(`   · not in sitemap: ${u}`);
    for (const f of sitemap.failures) console.log(`   🚫 child sitemap unreadable: ${f}`);
  }

  const htmlMode = results.filter((r) => r.mode === 'html').length;
  if (htmlMode > 0) {
    console.log(
      `📄 ${htmlMode}/${results.length} page(s) have no markdown endpoint and were compared on ` +
        `rendered code blocks, headings and inline code (exact, in order). Prose sentences are invisible in that mode.`,
    );
  }

  const driftedPages = all.filter((r) => r.drifted);
  const errors = all.filter((r) => r.error);
  const unpinned = results.filter((r) => r.status === 'unpinned');

  // Why exit 3, if it is.
  const unknownReasons = [
    ...errors.map((e) => `${e.docPath} -- ${e.error}`),
    ...(sitemap.error ? [`sitemap -- ${sitemap.error}`] : []),
    ...sitemap.failures.map((f) => `sitemap -- ${f}`),
    ...unpinned.map((u) => `${u.docPath} -- no pinned signature (run with --update to pin it)`),
  ];

  return {
    total: entries.length,
    checked: results.length,
    docsRoot: manifest.docsRoot,
    drifted: driftedPages.length > 0 || sitemap.newUnmapped.length > 0,
    unknown: unknownReasons.length > 0,
    unknownReasons,
    driftedPages,
    results: all,
    sitemap,
    errors,
  };
}

// Standalone execution
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const autoUpdate = args.includes('--update') || args.includes('--sync') || args.includes('-u');

  process.on('exit', () => {
    console.log(
      '\nℹ️  Scope: tracked pages compared, sitemap compared for new pages, watched repos compared by commit.\n' +
        '   Exit 0 clean · 2 drift · 3 could not read something (not a verdict).',
    );
  });

  const result = await checkAllDocDrift();
  if (result.sitemap.newUnmapped.length > 0) {
    console.log('🆕 [NEW UPSTREAM PAGES] Listed in the sitemap, tracked nowhere in this repo:');
    for (const u of result.sitemap.newUnmapped) console.log(` • ${u}`);
    console.log('   Snapshot them, or add them to sitemap.knownUnmapped in\n' +
      '   doc-snapshot/manifest.json to acknowledge them.\n');
  }
  const gone = result.driftedPages.filter((p) => p.status === '404' &&
    result.sitemap.missingFromSitemap?.includes(
      (/^https?:\/\//.test(p.docPath) ? p.docPath : `${new URL(result.docsRoot).origin}${p.docPath}`)
        .replace(/\/+$/, '')));
  if (gone.length > 0) {
    console.log('🗑️  [REMOVED OR RENAMED] 404 AND gone from the sitemap:');
    for (const p of gone) console.log(` • ${p.docPath}  (route(s): ${manifestRoutes(p.docPath)})`);
    console.log('   The route(s) still serve and the recorder still passes them. Decide, then delete.\n');
  }

  if (result.driftedPages.length > 0) {
    console.log('🚨 [DOC DRIFT DETECTED] The following upstream sources have changed:');
    console.log('───────────────────────────────────────────────────────────────────────────');
    for (const p of result.driftedPages) {
      console.log(` • [${p.severity}] ${p.docPath}`);
      if (p.oldHash && p.newHash) {
        console.log(`   Hash: ${p.oldHash} ➔ ${p.newHash}${p.file ? ` (${p.file})` : ''}`);
      }
      for (const line of p.detail ?? []) console.log(line);
    }
    console.log('───────────────────────────────────────────────────────────────────────────');
  }
  if (result.unknown) {
    console.log(`🚫 [NOT CHECKED] ${result.unknownReasons.length} thing(s) could not be verified:`);
    for (const r of result.unknownReasons) console.log(` • ${r}`);
    console.log('   Nothing above is a verdict on those.');
  }

  // Includes unpinned pages, so --update also takes first pins.
  const applicable = [...result.driftedPages, ...result.results.filter((r) => r.status === 'unpinned')];
  let wantUpdate = autoUpdate;
  if (!autoUpdate && applicable.length > 0 && process.stdin.isTTY) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question('\n❓ Update the local snapshot now? (y/N): ');
    rl.close();
    wantUpdate = ['y', 'yes'].includes(answer.trim().toLowerCase());
  }

  if (wantUpdate && applicable.length > 0) {
    console.log('\n🔄 Applying changes to doc-snapshot/...');
    const { unresolved } = await applyDocUpdates(applicable);
    const stillUnknown = result.errors.length > 0 || result.sitemap.error || result.sitemap.failures.length > 0;
    if (unresolved.length > 0 || result.sitemap.newUnmapped.length > 0) process.exit(2);
    process.exit(stillUnknown ? 3 : 0);
  }

  if (result.drifted) {
    console.log('\n👉 Local snapshot NOT modified. Pass `--update` (npm run drift:sync) to sync.');
    process.exit(2);
  }
  if (result.unknown) process.exit(3);
  console.log(`✅ [NO DOC DRIFT] All ${result.total} documentation pages match the local snapshot.`);
  process.exit(0);
}
