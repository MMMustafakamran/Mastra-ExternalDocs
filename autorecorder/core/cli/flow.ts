/**
 * What an adaptation declares in `config/cli.config.ts`.
 *
 * A flow is one command run under a real terminal, plus the ordered answers its
 * prompts need. Deliberately declarative: an adaptation should be able to
 * describe a completely different framework's CLI without touching `core/`.
 *
 * The design rule throughout is **name things, do not count them**. A step says
 * "select the row labelled Microsoft Agent Framework (Python)", never "press
 * Down twelve times". Counting works right up until the CLI adds a menu entry,
 * and then it silently picks the wrong one — which looks like a passing run
 * that scaffolded the wrong project.
 */
import { PROJECT } from '../../config/project.config';

/** Named keys, so a flow never contains raw escape bytes. */
export type CliKeyName =
  | 'Enter'
  | 'Up'
  | 'Down'
  | 'Left'
  | 'Right'
  | 'Esc'
  | 'Tab'
  | 'Space'
  | 'Backspace'
  | 'CtrlC';

/**
 * Byte sequences a PTY understands. Arrow keys must arrive as CSI escapes —
 * writing the letter "B" moves nothing.
 *
 * Built with fromCharCode rather than written as literal escape bytes: this
 * folder is copied between repos by hand, and a raw 0x1B in source is invisible
 * in an editor and does not survive every copy path intact.
 */
const ESC = String.fromCharCode(27);

export const KEY_SEQUENCES: Record<CliKeyName, string> = {
  Enter: String.fromCharCode(13),
  Up: `${ESC}[A`,
  Down: `${ESC}[B`,
  Right: `${ESC}[C`,
  Left: `${ESC}[D`,
  Esc: ESC,
  Tab: String.fromCharCode(9),
  Space: ' ',
  Backspace: String.fromCharCode(127),
  CtrlC: String.fromCharCode(3),
};

/** Walk a list prompt until the highlighted row is the one named. */
export interface CliSelect {
  /** Row label to land on. Substring match, case-insensitive. */
  label: string;

  /** Direction to walk. Down suits every list seen so far. */
  key?: Extract<CliKeyName, 'Down' | 'Up'>;

  /**
   * Give up after this many keypresses.
   *
   * Interactive lists wrap, so a label that never matches would otherwise loop
   * forever without ever erroring. The cap must exceed the list length; the
   * driver reports the labels it saw when it gives up.
   */
  max?: number;

  /** Glyphs marking the highlighted row. Defaults cover `❯` and `>`. */
  markers?: string[];

  /** Pause after each keypress so the list can repaint before it is read. */
  stepMs?: number;
}

export interface CliStep {
  /** Human label for logs, the report, and failure messages. */
  label: string;

  /**
   * Text that must appear on screen before this step acts.
   *
   * Always prefer this to a fixed delay. Prompt timing varies by minutes — an
   * npx cache miss, a sign-in round trip — and a timer that is generous enough
   * to be safe makes every recording that much longer.
   */
  waitFor?: string | RegExp;

  /**
   * Tolerate this step's prompt never appearing.
   *
   * Needed for genuinely conditional prompts: npx only asks to install when the
   * package is uncached, and some frameworks' starters never offer a chat
   * channel at all. An optional step that does not match is skipped, not failed.
   */
  optional?: boolean;

  /** Literal text to type — an app name, a project slug. */
  type?: string;

  /** Named keys sent in order, after `type` if both are present. */
  keys?: CliKeyName[];

  /** Walk a list to a named row. Runs before `keys`, which then confirm it. */
  select?: CliSelect;

  /**
   * Assert the screen after acting.
   *
   * The guard against a keystroke that landed somewhere unintended — the run
   * fails here, loudly, rather than four steps later for an unrelated-looking
   * reason.
   */
  expect?: string | RegExp;

  /** How long to wait for `waitFor`. Defaults to the flow's `stepTimeoutMs`. */
  timeoutMs?: number;

  /** Pause after acting, to let the next prompt paint. */
  settleMs?: number;
}

export interface CliFlowDefinition {
  /** CLI id, also the `--<id>` flag. Must be unique. */
  id: string;

  /** Human title for logs and the summary table. */
  name: string;

  /** Cast filename stem: `<videoPrefix>-cli-<NN>-<castName>.cast`. */
  castName: string;

  /** Working directory, relative to the repo root. Created if missing. */
  cwd: string;

  /** Executable and arguments. Not a shell string — no quoting rules to get wrong. */
  command: string;
  args?: string[];

  /** Extra environment for the child process. */
  env?: Record<string, string>;

  /** The prompts, in the order they appear. */
  steps?: CliStep[];

  /** Terminal size. Drives list viewport height, so keep it realistic. */
  cols?: number;
  rows?: number;

  /**
   * Screen text that means this run is over, however long its step timeout has
   * left.
   *
   * A CLI that has printed "Init failed" will never print the prompt being
   * waited for, and every second spent waiting is both wasted and misleading —
   * the run ends up blaming whichever step happened to be waiting rather than
   * naming the error that was on screen the whole time.
   */
  abortOn?: (string | RegExp)[];

  /** Default per-step wait. */
  stepTimeoutMs?: number;

  /** Whole-run cap, including waiting for exit. */
  timeoutMs?: number;

  /**
   * Screen text meaning the work is done, whether or not the process exits.
   *
   * Some CLIs print their success banner and then keep the terminal open. There
   * is nothing left to wait for, but "the command never exited" is what gets
   * reported — failing a run whose own last line says it succeeded. When this
   * matches, the process is stopped and the run counts as successful; the exit
   * code is not consulted, because the exit was ours.
   */
  doneWhen?: string | RegExp;

  /** Exit code that counts as success. Defaults to 0. */
  expectExitCode?: number;

  /**
   * Paths that must exist when the run finishes, relative to the repo root.
   *
   * The difference between "the keystrokes were accepted" and "the command did
   * its job". A CLI can answer every prompt happily and still write nothing.
   */
  expectFiles?: string[];

  /** Doc page this flow is evidence for, appended to `docBaseUrl`. */
  docPath?: string;

  /**
   * After this flow succeeds, write `VERSIONS.md` into this app directory.
   *
   * Set on installs: the resolved versions can only be read once something is
   * installed, and they are what the demo puts on screen. Doing it here means
   * the file cannot go stale relative to the install it describes.
   */
  versionsFor?: string;

  /**
   * How the captured session is paced when it is replayed on camera.
   *
   * Only affects the video — the cast on disk keeps the real timings, so the
   * QA record is never the edited one. A dependency install is four minutes of
   * a spinner and wants aggressive compression; an interactive session wants
   * almost none, because the pauses are someone reading the prompt.
   */
  render?: {
    /** Longest gap between two events, in seconds. Caps dead air. */
    maxGapSec?: number;
    /** Playback multiplier applied after gap capping. */
    speed?: number;
    /** Terminal font size in px. */
    fontSize?: number;
    /** Title-bar text. Defaults to the flow name. */
    title?: string;
  };

  /**
   * Skip by default in a full run.
   *
   * For flows that are slow, destructive, or need a human present — they stay
   * addressable by id but do not run when everything else does.
   */
  manual?: boolean;
}

/** A flow definition with everything resolved. What the driver consumes. */
export interface CliFlowConfig extends CliFlowDefinition {
  /** 1-based position in the registry, used for the filename index. */
  order: number;
  /** Cast filename, without a directory. */
  castFile: string;
  /** Report filename, without a directory. */
  reportFile: string;
  /** Absolute doc URL, when `docPath` is set. */
  docUrl?: string;
}

/**
 * One video, assembled from one or more captured flows.
 *
 * Flows and videos are separate because they are cut differently. A flow is a
 * unit of *work* — one command, captured once. A video is a unit of
 * *explanation*, and four package managers installing the same project belong
 * in one clip, since the whole point of running four is the comparison.
 */
export interface CliVideoDefinition {
  /** CLI id, also the `--<id>` flag. */
  id: string;

  /** Human title for logs and the summary table. */
  name: string;

  /** Video filename stem after the prefix: `<videoPrefix>-<videoName>.webm`. */
  videoName: string;

  /** Doc page shown before the terminal, appended to `docBaseUrl`. */
  docPath?: string;

  /** Flow ids, in order. Each becomes a terminal segment in this video. */
  flows: string[];

  /**
   * Files shown in the IDE before the terminal.
   *
   * A finding has to pin installed versus declared versions — the resolved
   * versions beside the manifest that declared them, and the line that breaks.
   */
  ideTabs?: { filePath: string; startLine: number; endLine: number }[];

  /** Seconds spent on each IDE tab. */
  ideDwellMs?: number;

  /**
   * The written finding, typed into Notepad at the end.
   *
   * So the clip explains itself to someone who was not here, instead of
   * depending on a separate document that drifts away from it.
   */
  notepad?: { filename: string; body: string; charDelayMs?: number };

  /**
   * Narration muxed in after recording, relative to the autorecorder folder.
   *
   * Playwright records silent video, so a voiceover is added afterwards. That
   * also keeps the two independent: re-shooting the picture does not mean
   * re-recording the voice, and vice versa.
   */
  audio?: string;

  /**
   * What the third clip of this set is when the capture behind this video
   * FAILED: a finding, filmed from the same cast.
   *
   * The deliverable per package manager is three clips — the CLI, the
   * install, and then *either* the app running *or* the reason it does not.
   * Which of the two is not a choice anyone makes by hand; it is what the
   * install report says. When the report says the install failed, this
   * describes the finding clip: the files that pin installed against declared
   * versions, and a written explanation. The explanation is optional — with
   * none given, the note is built from the report itself (the command, the
   * exit code, what was missing, the last lines on screen), so a failure that
   * nobody has analysed yet still produces a clip that names the error.
   */
  onFailure?: {
    id: string;
    name: string;
    videoName: string;
    ideTabs?: { filePath: string; startLine: number; endLine: number }[];
    ideDwellMs?: number;
    /** Hand-written analysis, appended under the generated error summary. */
    analysis?: string;
    notepadFile?: string;
    charDelayMs?: number;
    audio?: string;
  };

  /**
   * What the third clip is when the capture SUCCEEDED: a page recording of
   * the scaffolded app, by id from `pages.config.ts`. `npm run cli:videos`
   * records it after rendering; `npm run record -- --<id>` does it alone.
   */
  onSuccess?: { recordPage: string };
}

export interface CliVideoConfig extends CliVideoDefinition {
  order: number;
  /** Video filename stem, without extension. */
  videoFile: string;
  docUrl?: string;
  /** Finding clip filename stem, when `onFailure` is set. */
  failureVideoFile?: string;
}

export function defineCliVideos(defs: CliVideoDefinition[]): CliVideoConfig[] {
  return defs.map((def, i) => {
    const order = i + 1;
    return {
      ...def,
      order,
      videoFile: `${PROJECT.videoPrefix}-${def.videoName}`,
      failureVideoFile: def.onFailure
        ? `${PROJECT.videoPrefix}-${def.onFailure.videoName}`
        : undefined,
      docUrl: def.docPath
        ? `${PROJECT.docBaseUrl.replace(/\/$/, '')}/${def.docPath.replace(/^\//, '')}`
        : undefined,
    };
  });
}

/**
 * Resolves declarative flow definitions into what the driver runs.
 *
 * Called once by `config/cli.config.ts`. Filenames are derived here so an
 * adaptation never numbers files by hand and cast names always follow registry
 * order, exactly as `definePages` does for video pages.
 */
export function defineCliFlows(defs: CliFlowDefinition[]): CliFlowConfig[] {
  const seen = new Set<string>();

  return defs.map((def, i) => {
    if (seen.has(def.id)) {
      throw new Error(
        `Duplicate CLI flow id "${def.id}" in cli.config.ts — ids address flows on the command line and must be unique.`,
      );
    }
    seen.add(def.id);

    const order = i + 1;
    const stem = `${PROJECT.videoPrefix}-cli-${String(order).padStart(2, '0')}-${def.castName}`;

    return {
      ...def,
      order,
      castFile: `${stem}.cast`,
      reportFile: `${stem}.report.json`,
      docUrl: def.docPath
        ? `${PROJECT.docBaseUrl.replace(/\/$/, '')}/${def.docPath.replace(/^\//, '')}`
        : undefined,
    };
  });
}
