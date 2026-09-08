// FILE: sshOutcome.ts
// Purpose: Maps a raw ssh process result to a ServerTestOutcome and redacts stderr for display.
// Layer: Servers domain helpers
import type { ServerTestOutcome } from "@synara/contracts";

export interface RawSshResult {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
}

/** Never returns "host-key-unknown" for a key that was checked before login; that is decided upstream. */
export function classifySshResult(raw: RawSshResult): ServerTestOutcome {
  if (raw.timedOut) return "timeout";
  if (raw.code === 0) return "ok";
  const err = raw.stderr;
  if (/REMOTE HOST IDENTIFICATION HAS CHANGED/i.test(err)) return "host-key-changed";
  if (/host key is known for|Host key verification failed/i.test(err)) return "host-key-unknown";
  if (
    /Permission denied|Too many authentication failures|no supported authentication methods/i.test(
      err,
    )
  ) {
    return "auth-failed";
  }
  if (
    /Connection refused|Could not resolve|Network is unreachable|Connection timed out|No route to host|Name or service not known|nodename nor servname/i.test(
      err,
    )
  ) {
    return "unreachable";
  }
  return "error";
}

const MAX_MESSAGE_LENGTH = 500;

/** Strips each redaction, collapses whitespace, trims and caps the result at 500 characters. */
export function sanitizeSshStderr(stderr: string, redactions: ReadonlyArray<string>): string {
  let text = stderr;
  for (const redaction of redactions) {
    if (redaction.length > 0) text = text.split(redaction).join("[redacted]");
  }
  return text.replace(/\s+/g, " ").trim().slice(0, MAX_MESSAGE_LENGTH);
}
