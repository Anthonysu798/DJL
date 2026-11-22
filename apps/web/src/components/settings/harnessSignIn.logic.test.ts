import { describe, expect, it } from "vitest";

import { deriveSignInPhase, harnessSignInUrl, signInGuide } from "./harnessSignIn.logic";

const base = {
  started: true,
  startFailed: false,
  statusAtOpen: "required",
  status: "required",
  exitCode: undefined,
  checking: false,
} as const;

describe("deriveSignInPhase", () => {
  it("waits while the agent's sign-in command is still running", () => {
    expect(deriveSignInPhase({ ...base, started: false })).toBe("starting");
    expect(deriveSignInPhase(base)).toBe("waiting");
    expect(deriveSignInPhase({ ...base, exitCode: 0, checking: true })).toBe("waiting");
  });

  it("is connected as soon as an account that needed sign-in reports ready", () => {
    expect(deriveSignInPhase({ ...base, status: "ready" })).toBe("connected");
  });

  it("does not call an already connected account connected until this sign-in finishes", () => {
    const connected = { ...base, statusAtOpen: "ready", status: "ready" } as const;
    expect(deriveSignInPhase(connected)).toBe("waiting");
    expect(deriveSignInPhase({ ...connected, exitCode: 0 })).toBe("connected");
    expect(deriveSignInPhase({ ...connected, exitCode: 1 })).toBe("failed");
  });

  it("trusts a clean exit when the account check cannot tell", () => {
    expect(deriveSignInPhase({ ...base, status: "unknown", exitCode: 0 })).toBe("connected");
    expect(deriveSignInPhase({ ...base, status: "unknown", exitCode: 1 })).toBe("failed");
  });

  it("fails when the command ends and the account still needs sign-in", () => {
    expect(deriveSignInPhase({ ...base, exitCode: 0 })).toBe("failed");
    expect(deriveSignInPhase({ ...base, exitCode: null })).toBe("failed");
    expect(deriveSignInPhase({ ...base, started: false, startFailed: true })).toBe("failed");
  });
});

describe("harnessSignInUrl", () => {
  it("finds the sign-in page an agent printed", () => {
    const cursor =
      "If your browser didn't open, use this link:\r\nhttps://cursor.com/loginDeepControl?challenge=abc&mode=login\r\n";
    expect(harnessSignInUrl("cursor", cursor)).toBe(
      "https://cursor.com/loginDeepControl?challenge=abc&mode=login",
    );
    expect(harnessSignInUrl("grok", "Open https://accounts.x.ai/oauth2/authorize?x=1 \n")).toBe(
      "https://accounts.x.ai/oauth2/authorize?x=1",
    );
  });

  it("ignores other links, other hosts for known agents, and links with credentials", () => {
    expect(harnessSignInUrl("grok", "Docs: https://docs.x.ai/build/overview \n")).toBeNull();
    expect(harnessSignInUrl("codex", "https://evil.example/auth/login \n")).toBeNull();
    expect(harnessSignInUrl("gemini", "https://user:pw@example.com/login \n")).toBeNull();
    expect(harnessSignInUrl("gemini", "http://example.com/login \n")).toBeNull();
  });
});

describe("signInGuide", () => {
  it("shows the agent's own screen only when something has to be chosen or typed there", () => {
    expect(signInGuide("cursor")).toBe("browser");
    expect(signInGuide("gemini")).toBe("pick");
    expect(signInGuide("pi")).toBe("slashLogin");
  });
});
