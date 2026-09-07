/**
 * Renders a captured cast as a Windows Terminal window the recorder can film.
 *
 * The page is entirely self-contained: xterm.js and its stylesheet are inlined
 * from `node_modules` rather than pulled from a CDN. The recorder must work
 * offline and produce byte-identical frames on every run, and a CDN gives up
 * both — a slow fetch shows an empty window for the first second of the video,
 * and a version bump changes the rendering underneath a suite of recordings
 * nobody re-watched.
 *
 * Replay is driven by the page, not by Playwright: writing bytes one event at a
 * time over CDP would put a round trip between every character and turn a
 * 3-minute cast into something much longer and visibly jerky. The engine starts
 * the replay and waits for it to finish.
 */
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { type Cast } from './cast';

const require = createRequire(import.meta.url);

export interface TerminalRenderOptions {
  /** The cast to replay. Compress it before passing it in, not after. */
  cast: Cast;

  /** Title-bar text. Defaults to the cast's own title. */
  title?: string;

  /** Terminal font size in px. */
  fontSize?: number;

  /** Beat before the first byte, so the window is on screen before it fills. */
  startDelayMs?: number;

  /** Hold on the final frame, so the last output is readable before cutting. */
  endHoldMs?: number;
}

/** Resolves a file inside the installed @xterm/xterm package. */
function xtermAsset(relative: string): string {
  const pkgJson = require.resolve('@xterm/xterm/package.json');
  const file = join(dirname(pkgJson), relative);
  if (!existsSync(file)) {
    throw new Error(
      `@xterm/xterm is installed but ${relative} is missing (looked in ${file}). ` +
        `Run npm install in autorecorder/.`,
    );
  }
  return readFileSync(file, 'utf-8');
}

/**
 * Embeds JSON in a <script> without letting its contents close the tag.
 *
 * A cast is terminal output: it can contain literally anything, including the
 * characters `</script>`, and one such sequence would truncate the page.
 */
function embedJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(new RegExp(String.fromCharCode(0x2028), 'g'), '\\u2028')
    .replace(new RegExp(String.fromCharCode(0x2029), 'g'), '\\u2029');
}

export function generateTerminalHtml(opts: TerminalRenderOptions): string {
  const { cast } = opts;
  const title = opts.title ?? cast.header.title ?? 'Windows PowerShell';
  const fontSize = opts.fontSize ?? 16;
  const startDelayMs = opts.startDelayMs ?? 900;
  const endHoldMs = opts.endHoldMs ?? 2500;

  const xtermCss = xtermAsset('css/xterm.css');
  const xtermJs = xtermAsset('lib/xterm.js');

  // Only output events are replayed. The "i" events are the driver's own
  // keystrokes, kept in the cast as a transcript — replaying them too would
  // double every character the CLI already echoed.
  const outputEvents = cast.events.filter(([, code]) => code === 'o');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>${xtermCss}</style>
<style>
  html, body {
    margin: 0;
    padding: 0;
    height: 100%;
    background: #1e1e1e;
    overflow: hidden;
    font-family: 'Segoe UI', system-ui, sans-serif;
  }
  #desktop {
    height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    background: linear-gradient(135deg, #0f2027 0%, #16222a 55%, #1e1e1e 100%);
  }
  #window {
    width: 1280px;
    max-width: 92vw;
    border-radius: 8px;
    overflow: hidden;
    background: #0c0c0c;
    box-shadow: 0 24px 64px rgba(0, 0, 0, 0.65), 0 0 0 1px rgba(255, 255, 255, 0.06);
    display: flex;
    flex-direction: column;
  }
  #titlebar {
    height: 36px;
    background: #1f1f1f;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-left: 8px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    flex: none;
  }
  #tab {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 28px;
    padding: 0 14px;
    border-radius: 6px 6px 0 0;
    background: #0c0c0c;
    color: #e5e7eb;
    font-size: 12.5px;
  }
  #controls { display: flex; }
  #controls span {
    width: 46px;
    height: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #d1d5db;
    font-size: 11px;
  }
  #term-host { padding: 10px 12px 14px 12px; }
  .xterm .xterm-viewport { overflow: hidden !important; }
</style>
<style>@keyframes __arWinIn{from{opacity:0;transform:scale(.992)}to{opacity:1;transform:none}}body{animation:__arWinIn .18s ease-out both}</style>
</head>
<body>
  <div id="desktop">
    <div id="window">
      <div id="titlebar">
        <div id="tab">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <path d="m5 8 4 4-4 4" stroke="#34d399" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
            <line x1="12" y1="16" x2="18" y2="16" stroke="#9ca3af" stroke-width="2.2" stroke-linecap="round"/>
          </svg>
          <span>${escapeHtml(title)}</span>
        </div>
        <div id="controls"><span>&#8211;</span><span>&#9723;</span><span>&#10005;</span></div>
      </div>
      <div id="term-host"></div>
    </div>
  </div>

<script>${xtermJs}</script>
<script>
(function () {
  var EVENTS = ${embedJson(outputEvents)};
  var COLS = ${cast.header.width};
  var ROWS = ${cast.header.height};

  var term = new window.Terminal({
    cols: COLS,
    rows: ROWS,
    fontSize: ${fontSize},
    fontFamily: "'Cascadia Mono', 'Cascadia Code', Consolas, 'Courier New', monospace",
    lineHeight: 1.15,
    cursorBlink: true,
    convertEol: false,
    scrollback: 0,
    theme: {
      background: '#0c0c0c',
      foreground: '#cccccc',
      cursor: '#ffffff',
      black: '#0c0c0c',
      red: '#e74856',
      green: '#16c60c',
      yellow: '#f9f1a5',
      blue: '#3b78ff',
      magenta: '#b4009e',
      cyan: '#61d6d6',
      white: '#cccccc',
      brightBlack: '#767676',
      brightRed: '#e74856',
      brightGreen: '#16c60c',
      brightYellow: '#f9f1a5',
      brightBlue: '#3b78ff',
      brightMagenta: '#b4009e',
      brightCyan: '#61d6d6',
      brightWhite: '#f2f2f2'
    }
  });
  term.open(document.getElementById('term-host'));

  window.__castReplayDone = false;
  window.__castEventCount = EVENTS.length;

  var sleep = function (ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  };

  window.__startCastReplay = async function () {
    await sleep(${startDelayMs});

    var previous = 0;
    for (var i = 0; i < EVENTS.length; i++) {
      var event = EVENTS[i];
      var gap = event[0] - previous;
      previous = event[0];
      // Sub-frame gaps are not perceivable and cost a timer each; batching them
      // keeps a cast with thousands of tiny writes from stuttering.
      if (gap > 0.016) await sleep(gap * 1000);
      term.write(event[2]);
    }

    // Let xterm flush its last write before the hold starts, or the final line
    // can be missing from the very frames the hold exists to show.
    await new Promise(function (r) { term.write('', r); });
    await sleep(${endHoldMs});
    window.__castReplayDone = true;
  };
})();
</script>
</body>
</html>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
