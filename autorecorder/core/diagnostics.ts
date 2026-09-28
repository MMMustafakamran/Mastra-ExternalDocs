import { PROJECT } from '../config/project.config';

export interface HealthCheckResult {
  frontendOk: boolean;
  backendOk: boolean;
  frontendError?: string;
  backendError?: string;
}

const FRONTEND_BASE_URL = PROJECT.frontendUrl;
const BACKEND_BASE_URL = PROJECT.backendUrl;

/** How long a service gets to answer before the pre-flight calls it dead. */
const READY_TIMEOUT_MS = 30000;

interface ProbeTarget {
  url: string;
  headers?: Record<string, string>;
}

/**
 * Every way one `localhost` URL can actually be reached.
 *
 * `localhost` is two addresses and a dev server binds only one of them: the
 * Angular server listens on `[::1]` alone, while Node's fetch resolves
 * `localhost` to `127.0.0.1` and gets a refusal - so a server a browser opens
 * fine probes as dead. Both literals are tried, carrying `Host: localhost:<port>`
 * because Angular's SSRF guard rejects a bracketed-IPv6 Host outright ("Header
 * host with value [::1]:4200 is not allowed"), which is a *response* and would
 * otherwise read as healthy.
 *
 * `ci/automate.mjs` has carried this in its own waits for some time. This
 * pre-flight did not, so on 2026-09-21 an Agno-angular shard whose frontend
 * answered only on `[::1]` aborted before launching a browser and filmed
 * nothing, while the consolidate step still reported green over 6 clips
 * instead of 9.
 *
 * Non-localhost URLs are returned untouched: 127.0.0.1 needs no help.
 */
function probeTargets(url: string): ProbeTarget[] {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return [{ url }];
  }
  if (parsed.hostname !== 'localhost') return [{ url }];

  const headers = { host: parsed.host };
  const swap = (literal: string): ProbeTarget => {
    const swapped = new URL(parsed.toString());
    swapped.hostname = literal;
    return { url: swapped.toString(), headers };
  };
  return [{ url }, swap('127.0.0.1'), swap('[::1]')];
}

/**
 * Poll every address for `url` until one answers or the deadline passes.
 *
 * One attempt was the other half of the same bug: the frontend got a single
 * 3s shot, so a dev server still compiling its first route read as down.
 */
async function waitForService(
  url: string,
  timeoutMs: number = READY_TIMEOUT_MS,
): Promise<{ ok: boolean; error?: string }> {
  const targets = probeTargets(url);
  const deadline = Date.now() + timeoutMs;
  let lastError = `Connection refused on ${url}`;

  for (;;) {
    for (const target of targets) {
      try {
        const res = await fetch(target.url, {
          headers: target.headers,
          signal: AbortSignal.timeout(3000),
        });
        if (res.ok || res.status < 500) return { ok: true };
        lastError = `HTTP ${res.status} from ${target.url}`;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        if (message) lastError = message;
      }
    }
    if (Date.now() >= deadline) return { ok: false, error: lastError };
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

/** Pre-flight check that both this project's services are up. */
export async function checkServicesHealth(): Promise<HealthCheckResult> {
  const result: HealthCheckResult = {
    frontendOk: false,
    backendOk: false,
  };

  const frontend = await waitForService(`${FRONTEND_BASE_URL}/`);
  result.frontendOk = frontend.ok;
  if (!frontend.ok) result.frontendError = frontend.error;

  const backend = await waitForService(
    `${BACKEND_BASE_URL}${PROJECT.backendHealthPath}`,
  );
  if (backend.ok) {
    result.backendOk = true;
  } else {
    // Some backends serve no health path but do serve docs. Short deadline:
    // the one above has already waited out anything slow to boot.
    const docs = await waitForService(`${BACKEND_BASE_URL}/docs`, 2000);
    result.backendOk = docs.ok;
    if (!docs.ok) result.backendError = backend.error;
  }

  return result;
}

/** Automatically analyzes error messages and produces actionable diagnostic guidance */
export function diagnoseError(error: unknown, context?: string): string {
  const errStr =
    error instanceof Error ? error.message : String(error ?? 'Unknown error');

  const backendPort = new URL(PROJECT.backendUrl).port;
  const frontendPort = new URL(PROJECT.frontendUrl).port;

  if (errStr.includes('ECONNREFUSED') || errStr.includes('Failed to fetch')) {
    if (errStr.includes(backendPort) || context?.includes('backend')) {
      return (
        `🔴 [Agent Backend Offline]: ${PROJECT.backendUrl} is not reachable.\n` +
        `   👉 Fix: ${PROJECT.backendStartCmd}`
      );
    }
    if (errStr.includes(frontendPort) || context?.includes('frontend')) {
      return (
        `🔴 [Frontend Offline]: ${PROJECT.frontendUrl} is not reachable.\n` +
        `   👉 Fix: ${PROJECT.frontendStartCmd}`
      );
    }
  }

  if (errStr.includes('Timeout') && errStr.includes('waitFor')) {
    return (
      '⚠️ [UI Selector Timeout]: Playwright timed out waiting for an expected element on screen.\n' +
      '   👉 Fix: Verify that the route loaded correctly and the button/input exists in the DOM.'
    );
  }

  if (
    errStr.includes('CopilotKit core not attached') ||
    errStr.includes('CopilotKitProvider')
  ) {
    return (
      '⚠️ [CopilotKit Provider Issue]: CopilotKit components require a wrapping CopilotKitProvider.\n' +
      '   👉 Fix: Check `frontend/src/components/providers.tsx`.'
    );
  }

  if (errStr.includes('404') || errStr.includes('Not Found')) {
    return (
      `⚠️ [Route Not Found (404)]: The requested URL could not be found.\n` +
      `   👉 Fix: Ensure the page route exists in \`frontend/src/app/\`.`
    );
  }

  return `ℹ️ [Diagnostic Note]: ${errStr}`;
}
