/**
 * Keeps the CLI pipeline out of CI.
 *
 * These commands are local-only by design, and not for one reason but four:
 *
 * - **Sign-in is interactive.** `copilotkit create` links the app to an
 *   Intelligence project, which opens a browser and finishes back at the
 *   terminal. A runner cannot complete that, and the CLI refuses to run at all
 *   in a shell with no terminal rather than opening a browser it cannot finish
 *   with.
 * - **They are side-effecting.** Scaffolding writes directories, and the
 *   installs fetch four dependency trees.
 * - **They spend someone's account.** The scaffold binds to a real hosted
 *   project, and the demos put prompts through a real model key.
 * - **The failure would be misread.** A CI run that timed out waiting for a
 *   browser sign-in looks exactly like a broken CLI, which is the opposite of
 *   what this suite exists to report.
 *
 * The guard is deliberately a refusal rather than a silent skip: a job that
 * quietly does nothing is how a suite ends up green while testing nothing.
 */

/** True when the process looks like it is running on a CI runner. */
export function isCi(): boolean {
  return Boolean(
    process.env.GITHUB_ACTIONS ||
      process.env.CI === 'true' ||
      process.env.CI === '1' ||
      process.env.BUILD_BUILDID || // Azure Pipelines
      process.env.GITLAB_CI,
  );
}

/** Set to override the guard, for a runner that genuinely can do this. */
const OVERRIDE_ENV = 'AUTORECORD_ALLOW_CI';
const OVERRIDE_FLAG = '--allow-ci';

/**
 * Exits with a non-zero status when running in CI, unless overridden.
 *
 * Call before doing any work, so nothing is half-done when it refuses.
 */
export function refuseInCi(commandName: string, argv: string[] = process.argv): void {
  if (!isCi()) return;
  if (process.env[OVERRIDE_ENV] || argv.includes(OVERRIDE_FLAG)) {
    console.warn(
      `⚠️ ${commandName} is running in CI because ${OVERRIDE_ENV}/${OVERRIDE_FLAG} was set. ` +
        `Expect it to hang at browser sign-in.`,
    );
    return;
  }

  console.error(`\n❌ ${commandName} does not run in CI.`);
  console.error(`   It signs in through a browser, scaffolds directories, installs`);
  console.error(`   dependencies and spends a real account — none of which a runner`);
  console.error(`   can do or should do. Run it locally.`);
  console.error(`\n   CI records doc pages with: node ci/automate.mjs  (npm run record)`);
  console.error(`   Override, if you are certain: ${OVERRIDE_ENV}=1 or ${OVERRIDE_FLAG}\n`);
  process.exit(1);
}
