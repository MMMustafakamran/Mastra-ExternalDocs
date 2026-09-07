/**
 * Shared paths, ports and URLs for the CI/CD pipeline.
 *
 * Everything under ci/ imports from here rather than rebuilding paths, so a
 * moved folder or a changed port is a one-line edit.
 *
 * ── One naming difference from the siblings ────────────────────────────────
 * The agent lives in `mastra-server/`, not `backend/`. That is the page's own
 * layout — its step 1 sketches `project-root/{mastra-server,my-copilot-app}` —
 * and keeping the name means the tree matches the guide a reader is following.
 * `BACKEND_DIR` still points at it, so nothing under ci/ needs to know.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const ROOT_DIR = path.resolve(__dirname, '..', '..');
export const CI_DIR = path.join(ROOT_DIR, 'ci');
export const BACKEND_DIR = path.join(ROOT_DIR, 'mastra-server');
export const FRONTEND_DIR = path.join(ROOT_DIR, 'frontend');
export const RECORDER_DIR = path.join(ROOT_DIR, 'autorecorder');
export const VIDEOS_DIR = path.join(RECORDER_DIR, 'videos');
export const AUDIO_DIR = path.join(RECORDER_DIR, 'audio');
export const LOGS_DIR = path.join(VIDEOS_DIR, 'logs');

export const isWindows = process.platform === 'win32';

/**
 * Prefix for CI artifact names. Matches the recorded video filenames
 * (`MASTRA-ext-02-ToolCallRendering.webm`).
 *
 * `-ext` separates these from the sibling `Mastra-react` repo, which tests the
 * same integration through CopilotKit's docs and writes `MASTRA-react-*`.
 */
export const PROJECT_SLUG = 'Mastra-ext';

/**
 * 4111 is the page's own: "By default, the Mastra server runs on
 * http://localhost:4111." Every published frontend snippet hardcodes
 * `runtimeUrl="http://localhost:4111/copilotkit"`, so moving it would mean
 * editing a doc snippet — which rule 1 forbids.
 */
export const BACKEND_PORT = Number(process.env.MASTRA_PORT || 4111);

/**
 * 3303. Eleven sibling repos in this workspace default to 3000, and the page
 * itself says `create-next-app` will use it. The external-docs repos take
 * 3301 (ag2), 3302 (agno), 3303 (mastra) so they can run side by side.
 */
export const FRONTEND_PORT = Number(process.env.FRONTEND_PORT || 3303);

/**
 * `/copilotkit` is POST-only, so it cannot serve as a probe. `mastra dev`
 * serves its playground at the root, which is the GET that proves the process
 * is up.
 */
export const BACKEND_HEALTH_URL = `http://127.0.0.1:${BACKEND_PORT}/`;
export const FRONTEND_URL = `http://127.0.0.1:${FRONTEND_PORT}`;

/**
 * Routes compiled before recording starts. Next builds routes on demand, so the
 * first hit of each is slow enough to blow the recorder's preflight timeout.
 */
export const WARMUP_ROUTES = ['/', '/quickstart/demo-chat', '/tool-rendering/demo-chat'];
