import { describe, expect, it } from "vitest";

import { classifySshResult, sanitizeSshStderr } from "./sshOutcome";

describe("classifySshResult", () => {
  it("maps exit 0 to ok", () => {
    expect(classifySshResult({ code: 0, stdout: "", stderr: "", timedOut: false })).toBe("ok");
  });
  it("maps permission denied to auth-failed", () => {
    expect(
      classifySshResult({
        code: 255,
        stdout: "",
        stderr: "deploy@h: Permission denied (publickey,password).",
        timedOut: false,
      }),
    ).toBe("auth-failed");
  });
  it("maps a changed host key", () => {
    expect(
      classifySshResult({
        code: 255,
        stdout: "",
        stderr: "@@@ WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED! @@@",
        timedOut: false,
      }),
    ).toBe("host-key-changed");
  });
  it("maps network failures to unreachable", () => {
    for (const line of [
      "ssh: connect to host h port 22: Connection refused",
      "ssh: Could not resolve hostname h",
      "Network is unreachable",
      "Connection timed out",
    ]) {
      expect(classifySshResult({ code: 255, stdout: "", stderr: line, timedOut: false })).toBe(
        "unreachable",
      );
    }
  });
  it("maps our own kill to timeout", () => {
    expect(classifySshResult({ code: null, stdout: "", stderr: "", timedOut: true })).toBe(
      "timeout",
    );
  });
  it("maps a strict unknown host to host-key-unknown when ssh reports it", () => {
    expect(
      classifySshResult({
        code: 255,
        stdout: "",
        stderr:
          "No ECDSA host key is known for h and you have requested strict checking.\r\nHost key verification failed.",
        timedOut: false,
      }),
    ).toBe("host-key-unknown");
  });
  it("falls back to error", () => {
    expect(
      classifySshResult({ code: 1, stdout: "", stderr: "something else", timedOut: false }),
    ).toBe("error");
  });
});

describe("sanitizeSshStderr", () => {
  it("removes redactions, collapses whitespace and caps length", () => {
    const out = sanitizeSshStderr("bad /tmp/secret-1 thing\n\n  more  ", ["/tmp/secret-1"]);
    expect(out).toBe("bad [redacted] thing more");
    expect(sanitizeSshStderr("x".repeat(900), []).length).toBe(500);
  });
});
