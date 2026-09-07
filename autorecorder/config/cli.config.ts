/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  ADAPT THIS FILE — 4 of 4
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * This framework's terminal flows — the scaffolding CLI and the installs.
 *
 * ── There are none here, deliberately ──────────────────────────────────────
 * `cli-capture.ts`, `cli-render.ts` and `core/doctor.ts` all import from this
 * file, so the three exports have to exist. They are empty, and that is a
 * decision rather than an unfinished port:
 *
 * 1. **The CLI is not this repo's subject.** These four repos test each
 *    vendor's *own* documentation. The one CLI any of them mentions is
 *    `npx copilotkit@latest create`, which belongs to CopilotKit — and the
 *    eleven repos in the parent folder already record it, per framework, with a
 *    prompt-order driver that took several rounds of real runs to get right.
 *    A second, unverified copy of that driver here would be a liability: it
 *    would either duplicate a fix or silently miss one.
 *
 * 2. **An untested flow is worse than no flow.** `select: { label }` walks a
 *    list until the highlighted row matches. Written from the docs rather than
 *    from a captured session, it can land on the wrong row and report success
 *    while doing it. That failure mode is the reason `core/cli/flow.ts` insists
 *    on naming rows instead of counting keypresses, and it is not one to
 *    reintroduce by guessing.
 *
 * If this framework later documents a CLI of its own, the way to add it is:
 * capture one real session first (`npm run capture -- --<id>`), read the cast,
 * and write the steps from what the terminal actually printed. Not the other
 * way round.
 *
 * See `../PORT-CLI.md` for the full pipeline, and the sibling repos'
 * `config/cli.config.ts` for a worked example.
 */

import { defineCliFlows, defineCliVideos } from '../core/cli/flow';
import { type DistributionConfig } from '../core/cli/distribute';

/**
 * `cli-capture.ts --distribute` copies one scaffold into four package-manager
 * folders. Nothing is scaffolded here, so there is nothing to distribute.
 */
export const CLI_DISTRIBUTION: DistributionConfig = {
  source: '.',
  targets: [],
};

/** No terminal sessions are captured in this repo. See the header. */
export const CLI_FLOWS = defineCliFlows([]);

/** No terminal videos are rendered in this repo. See the header. */
export const CLI_VIDEOS = defineCliVideos([]);
