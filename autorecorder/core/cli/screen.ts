/**
 * Reading a TUI's screen out of a raw PTY byte stream.
 *
 * A terminal UI does not append text — it repaints. Every arrow key makes an
 * interactive list rewrite the whole block over itself using cursor-movement
 * escapes. Concatenating the PTY stream therefore gives every *historical*
 * frame, not the current one, and naive matching against that buffer answers
 * questions about a screen that is no longer there. The classic symptom: a
 * driver that "confirms" the highlight is on the row it wanted while the real
 * highlight moved past it ten keypresses ago.
 *
 * The helpers here work on the tail of the stream on purpose — the last frame
 * emitted is the one currently on screen.
 */

const ESC = String.fromCharCode(27);
const CSI = String.fromCharCode(155);
const BEL = String.fromCharCode(7);

/**
 * CSI and OSC escape sequences, including the OSC form terminated by BEL, which
 * ConPTY emits constantly to set the window title and which otherwise leaks
 * into the middle of matched text.
 *
 * Built from fromCharCode rather than written as a regex literal: an ESC byte
 * inside a literal is invisible in every editor, and an editor that eats it
 * leaves a pattern that still compiles, still runs, and silently stops
 * stripping anything — which surfaces as prompts that mysteriously never match.
 */
const ANSI_PATTERN = new RegExp(
  '[' +
    ESC +
    CSI +
    '][[\\]()#;?]*(?:(?:[a-zA-Z\\d]*(?:;[-a-zA-Z\\d/#&.:=?%@~_]*)*)?' +
    BEL +
    '|(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-nq-uy=><~])',
  'g',
);

/**
 * OSC sequences on their own: `ESC ] ... BEL` or `ESC ] ... ESC \`.
 *
 * The combined pattern above only allows a narrow character set inside an
 * OSC, so a window title with a space in it -- `Windows PowerShell`, which
 * ConPTY sets on every prompt -- was left half-stripped as `;Windows
 * PowerShell<BEL>` in the middle of matched text. Found by the unit test, not
 * by a run: the leak happened to land between prompts often enough to miss.
 */
const OSC_PATTERN = new RegExp(
  ESC + '\\][^' + BEL + ESC + ']*(?:' + BEL + '|' + ESC + '\\\\)',
  'g',
);

export function stripAnsi(input: string): string {
  return input.replace(OSC_PATTERN, '').replace(ANSI_PATTERN, '');
}

/**
 * Flattens a PTY stream into matchable text.
 *
 * Carriage returns become newlines rather than being dropped: a spinner that
 * redraws with a bare CR would otherwise glue its frames into one long
 * unmatchable line.
 */
export function toScreenText(raw: string): string {
  return stripAnsi(raw)
    .split(String.fromCharCode(13))
    .join(String.fromCharCode(10))
    .split(String.fromCharCode(10, 10))
    .join(String.fromCharCode(10));
}

/** Default glyphs a CopilotKit-style TUI uses to mark the highlighted row. */
export const DEFAULT_SELECTION_MARKERS = ['❯', '>', '›', '→'];

/**
 * The label of the currently highlighted row in a list prompt.
 *
 * Takes the *last* marked line in the stream, which is the one from the most
 * recent repaint. Returns null when no marked line is present — the caller must
 * treat that as "the list has not painted yet", not as "no match".
 *
 * Numbering is stripped (`1. Slack` -> `Slack`) so a config can name the option
 * the way a human reads it rather than encoding the menu's ordinal, which is
 * exactly the coupling that breaks when the menu gains an entry.
 */
export function highlightedLabel(
  raw: string,
  markers: string[] = DEFAULT_SELECTION_MARKERS,
): string | null {
  const lines = toScreenText(raw).split(String.fromCharCode(10));

  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line) continue;

    const marker = markers.find((m) => line.startsWith(m));
    if (!marker) continue;

    const label = line
      .slice(marker.length)
      .replace(/^\s*\d+[.)]\s*/, '')
      .trim();

    // A bare marker is the prompt's own cursor on an empty input line, not a
    // highlighted list row.
    if (label.length === 0) continue;
    return label;
  }
  return null;
}

/**
 * Does the tail of the stream contain this pattern?
 *
 * Matching is confined to a window at the end of the stream so that a prompt
 * which appeared and was answered minutes ago cannot satisfy a later wait. The
 * window is generous: enough to hold several full repaints of a long list, far
 * short of the whole session.
 */
export function tailMatches(
  raw: string,
  pattern: string | RegExp,
  windowChars = 20000,
): boolean {
  const text = toScreenText(raw.slice(-windowChars));
  if (typeof pattern === 'string') {
    return text.toLowerCase().includes(pattern.toLowerCase());
  }
  return pattern.test(text);
}

/** Last non-empty lines, for logs and failure reports. */
export function lastLines(raw: string, count = 12): string {
  return toScreenText(raw)
    .split(String.fromCharCode(10))
    .map((l) => l.trimEnd())
    .filter((l) => l.length > 0)
    .slice(-count)
    .join(String.fromCharCode(10));
}
