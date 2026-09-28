/**
 * Masks credentials in captured terminal output, before it reaches a cast file.
 *
 * The recorder films whatever the PTY printed. That was safe for as long as
 * every flow was a package install, and it stopped being safe the moment a
 * sign-in flow was recorded: `casts/*-Login.cast` holds the CLI's own auth URL,
 * complete with the `state` token that authorises the round trip, plus the
 * operator's email and organisation. All of it is replayed into the filmed
 * xterm window and lands in a published `.webm`.
 *
 * Nothing here is a substitute for not printing secrets. It is a floor: the
 * flows are still written so that no key is ever typed in (see the
 * `Skip model API key` step in `cli.config.ts` and the out-of-band seeding in
 * `distribute.ts`). This catches what the CLI chooses to print on its own,
 * which the flow author does not control and cannot predict across `@latest`.
 *
 * ── Masking, not deleting ──────────────────────────────────────────────────
 * Every masked character is replaced one-for-one with `x`. A cast is replayed
 * into a fixed-width terminal, so dropping or shortening a run would reflow
 * every line after it and desynchronise the recording from what the operator
 * actually saw. Same length, same wraps, same layout — only the value changes.
 *
 * ── Line wraps ─────────────────────────────────────────────────────────────
 * A 32-character token printed into a 120-column terminal can be split by a
 * hard wrap, and the real captured login cast contains exactly that:
 *
 *     ...&state=11278bc6d01
 *     0d080bf8e9bec011c93f6&posthog_distinct_id=...
 *
 * A naive /state=[0-9a-f]{32}/ misses it and leaves the token on camera. So a
 * value run may absorb ONE newline, and only when what follows it continues as
 * token characters for `MIN_WRAP_TAIL` or more — enough to tell a wrapped token
 * from a token that simply ended and was followed by ordinary prose.
 */

/** Characters that can appear inside a URL-safe token or key. */
const TOKEN_CHAR = /[A-Za-z0-9\-._~%+/]/;

/**
 * How many token characters must follow a newline for it to count as a wrap
 * rather than the end of the value. The real wrapped `state` token continues
 * for 21; the shortest thing that could follow a finished value and be
 * mistaken for a continuation ("Tip:", "Email:") stops well below this.
 */
const MIN_WRAP_TAIL = 8;

/**
 * Query parameters and env assignments whose value is a credential.
 *
 * `state` is the CSRF token for the CLI's browser round trip, and
 * `posthog_distinct_id` identifies the operator across sessions — neither is a
 * password, and both are exactly the sort of thing that should not be sitting
 * in a video handed to a client.
 */
const SECRET_LABELS =
  /(?:^|[?&\s"'`=[({,;]|\x1b\[[0-9;]*[A-Za-z])((?:cpk_)?(?:state|code|nonce|posthog_distinct_id|access[_-]?token|id[_-]?token|refresh[_-]?token|auth[_-]?token|session[_-]?token|token|secret|password|passwd|api[_-]?key|apikey|[A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD)))=/gi;

/** Standalone credential shapes that carry no label. */
const BARE_SECRETS: readonly RegExp[] = [
  // JWTs — COPILOTKIT_LICENSE_TOKEN is an EdDSA-signed one.
  /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
  // OpenAI-style and CopilotKit-style keys.
  /\bsk-[A-Za-z0-9_-]{16,}/g,
  /\bcpk_[A-Za-z0-9_-]{12,}/g,
  // Email addresses: not a credential, but personal data the operator did not
  // choose to publish by running a recorder.
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
];

/** Replaces every character of `run` with `x`, leaving CR and LF in place. */
function maskRun(run: string): string {
  let out = '';
  for (const ch of run) {
    out += ch === '\r' || ch === '\n' ? ch : 'x';
  }
  return out;
}

/**
 * Reads the value that follows `label=` at `from`, absorbing at most one hard
 * wrap. Returns the end index (exclusive) of the value.
 */
function endOfValue(text: string, from: number): number {
  let i = from;
  let absorbedWrap = false;

  while (i < text.length) {
    const ch = text[i];

    if (TOKEN_CHAR.test(ch)) {
      i += 1;
      continue;
    }

    if ((ch === '\r' || ch === '\n') && !absorbedWrap) {
      // Look past the line break: is this a wrapped token, or did the value
      // end here and ordinary output follow?
      let j = i;
      if (text[j] === '\r' && text[j + 1] === '\n') j += 2;
      else j += 1;

      let tail = 0;
      while (j + tail < text.length && TOKEN_CHAR.test(text[j + tail])) tail += 1;

      if (tail >= MIN_WRAP_TAIL) {
        absorbedWrap = true;
        i = j + tail;
        continue;
      }
    }

    break;
  }

  return i;
}

/**
 * Masks every credential-shaped run in a chunk of terminal output.
 *
 * Safe to call on arbitrary bytes: ANSI escape sequences contain no `=` runs
 * that match `SECRET_LABELS`, and masking preserves length, so cursor
 * positioning in the replayed terminal is unaffected.
 */
export function redactText(text: string): string {
  if (text.length === 0) return text;

  let out = '';
  let cursor = 0;

  SECRET_LABELS.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = SECRET_LABELS.exec(text)) !== null) {
    const valueStart = match.index + match[0].length;
    const valueEnd = endOfValue(text, valueStart);
    if (valueEnd === valueStart) continue;

    out += text.slice(cursor, valueStart) + maskRun(text.slice(valueStart, valueEnd));
    cursor = valueEnd;
    SECRET_LABELS.lastIndex = valueEnd;
  }
  out += text.slice(cursor);

  for (const pattern of BARE_SECRETS) {
    pattern.lastIndex = 0;
    out = out.replace(pattern, (hit) => maskRun(hit));
  }

  return out;
}

/**
 * True when `text` still contains something that looks like a credential.
 *
 * Used by the capture pass to warn rather than to block: a run that took
 * fifteen minutes of a human's attention should not be discarded because a
 * pattern fired, but the operator should be told before the cast is filmed.
 */
export function looksUnredacted(text: string): boolean {
  return redactText(text) !== text;
}
