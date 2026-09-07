import { type Page } from 'playwright';
import { PROJECT, demoUrlFor, docUrlFor } from '../config/project.config';
import { type ServiceDefinition } from './cli/service';
import { type IdeTabConfig } from './ide/generator';

export { type IdeTabConfig };

/**
 * A dev server this page's demo needs, and which the recording shows starting.
 *
 * When present, the engine boots it before filming, replays its boot in a
 * terminal window between the IDE and the demo, points the demo at
 * `originUrl`, and kills it afterwards. The terminal segment is therefore the
 * actual process serving the app in the next segment.
 */
export interface PageDevServer extends ServiceDefinition {
  /** Where the demo is reached once this is up, e.g. `http://localhost:3101`. */
  originUrl: string;

  /**
   * Path to open on that origin. Defaults to `/`.
   *
   * A scaffolded starter is a different application from this repo's frontend —
   * it has its own routes and none of this project's `demoSuffix` convention —
   * so its URL is built from the origin and this, not from `route`.
   */
  demoPath?: string;

  /** Terminal title-bar text. Defaults to the command line. */
  title?: string;

  /** Pacing for the boot replay. A cold compile is mostly waiting. */
  render?: { maxGapSec?: number; speed?: number };
}

/**
 * What an adaptation writes in `config/pages.config.ts`.
 *
 * Deliberately smaller than PageRecordConfig: URLs and filenames are derived
 * rather than repeated, so no entry can drift onto another framework's docs and
 * the video numbering always matches nav order.
 */
export interface PageDefinition {
  /** CLI id, also the `--<id>` flag. Must be unique. */
  id: string;

  /** Human title for logs and the summary table. */
  name: string;

  /** Video filename stem: `<videoPrefix>-<NN>-<videoName>.webm`. */
  videoName: string;

  /**
   * Replaces the derived `<NN>-<videoName>` stem with this, after the prefix.
   *
   * For pages that belong to a numbered *set* rather than to the doc-nav order —
   * the per-package-manager videos, where the three files of one manager's set
   * need to sort together and be readable as a set. Leave unset everywhere else,
   * so nav order keeps naming the files.
   */
  videoFile?: string;

  /** Appended to `PROJECT.docBaseUrl`. Query strings are fine. */
  docPath: string;

  /** Appended to `PROJECT.frontendUrl`, then `PROJECT.demoSuffix`. */
  route: string;

  /** Repo-relative source file the simulated IDE shows. */
  ideFile: string;

  /** Inclusive highlight range in `ideFile`. Guarded by `npm run doctor`. */
  startLine: number;
  endLine: number;

  /** Extra IDE tabs to switch through, each with its own range. */
  extraTabs?: IdeTabConfig[];

  /** Prompt to send. For multi-turn pages this is the first one. */
  prompt: string;

  /** Ordered prompts for pages driving several turns or tabs. */
  prompts?: string[];

  /** Reading pause after the reply finishes streaming. */
  waitAfterPromptMs?: number;

  /**
   * Boot a dev server for this page, and show it booting.
   *
   * Omit for pages that run against the repo's own frontend — which is all of
   * them, apart from the package-manager matrix, where each scaffold is its own
   * app on its own port.
   */
  devServer?: PageDevServer;

  /**
   * This page's `ideFile` does not exist until the CLI pipeline has run.
   *
   * The doctor must not fail on a matrix page before the scaffold has been
   * created and distributed — the files genuinely are not there yet — but it
   * still says so, because a missing file at record time is a real problem.
   */
  generated?: boolean;

  /** Per-page overrides of the recorder's fixed waits. See `RecorderTimeouts`. */
  timeouts?: Partial<RecorderTimeouts>;
}

/** A page definition with everything resolved. What the engine consumes. */
export interface PageRecordConfig extends PageDefinition {
  docUrl: string;
  demoUrl: string;
  filename: string;
  /** 1-based position in the registry, used for the filename index. */
  order: number;
}

/**
 * Resolves declarative page definitions into what the engine runs.
 *
 * Called once by `config/pages.config.ts`; nothing else should build a
 * PageRecordConfig by hand, or the derived-URL guarantee stops holding.
 */
export function definePages(defs: PageDefinition[]): PageRecordConfig[] {
  return defs.map((def, i) => {
    const order = i + 1;
    return {
      ...def,
      order,
      docUrl: docUrlFor(def.docPath),
      demoUrl: def.devServer
        ? `${def.devServer.originUrl.replace(/\/$/, '')}${def.devServer.demoPath ?? '/'}`
        : demoUrlFor(def.route),
      filename: def.videoFile
        ? `${PROJECT.videoPrefix}-${def.videoFile}`
        : `${PROJECT.videoPrefix}-${String(order).padStart(2, '0')}-${def.videoName}`,
    };
  });
}

/**
 * How a page handler reports what it saw, so the summary and CI see it too.
 *
 * Before this, a handler that noticed "the weather card never rendered" could
 * only `console.log` it. The run still printed `[PASS]` with no asterisk, and
 * the CI report carried nothing. `warn` puts the note on the result as `PASS*`;
 * `fail` marks the recording failed once the handler returns, so the clip is
 * still filmed to the end and still saved as evidence.
 */
export interface ActionContext {
  /** The clip is usable but something the doc promises was not observed. */
  warn: (message: string) => void;
  /** The feature under test did not work. The recording finishes, then fails. */
  fail: (message: string) => void;
  /** Resolved timeouts for this page. */
  timeouts: RecorderTimeouts;
}

/**
 * Every fixed wait in the recorder, in one place.
 *
 * These used to be literals scattered through `core/`, and the yarn demo
 * failed on exactly one of them: a cold turbopack compile overran the 45s
 * demo navigation budget. Defaults live in `core/timeouts.ts`; a project sets
 * `PROJECT.timeouts` and a page sets `timeouts` to override.
 */
export interface RecorderTimeouts {
  /** Loading the external doc page. */
  docNavMs: number;
  /** Loading the demo route. First hit on a dev route compiles it. */
  demoNavMs: number;
  /** Chat surface visible after the demo route loads. */
  chatReadyMs: number;
  /** A reply *starting* after the prompt is sent. */
  replyStartMs: number;
  /** A reply finishing once it has started. */
  replyStreamMs: number;
}

export type PageActionHandler = (
  page: Page,
  config: PageRecordConfig,
  rootPath: string,
  ctx: ActionContext,
) => Promise<void>;
