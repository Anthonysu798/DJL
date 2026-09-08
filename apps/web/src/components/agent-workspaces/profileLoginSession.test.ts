import { describe, expect, it, vi } from "vitest";
import type { NativeApi } from "@synara/contracts";
import { createProfileLoginSession, providerSignInUrl } from "./profileLoginSession";
const profile = { id: "personal", provider: "codex" as const, name: "Personal" };
function mockApi() {
  return {
    server: { getConfig: vi.fn(async () => ({ cwd: "/repo", homeDir: "/home/user" })) },
    terminal: {
      open: vi.fn(async () => ({ status: "running" })),
      close: vi.fn(async () => {}),
    },
  };
}
describe("dedicated profile sign-in terminal", () => {
  it("starts official profile-scoped login without adding a workspace pane", async () => {
    const api = mockApi();
    const session = createProfileLoginSession(api as unknown as NativeApi, profile);
    const ready = await session.ready;
    expect(api.terminal.open).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: "/home/user",
        agentProfile: { provider: "codex", profileId: "personal", action: "login" },
      }),
    );
    await session.close();
    expect(api.terminal.close).toHaveBeenCalledWith({
      threadId: ready!.threadId,
      terminalId: "default",
      deleteHistory: true,
    });
  });
  it("waits for pending startup then closes only its own session", async () => {
    const api = mockApi();
    let resolve!: (value: { status: string }) => void;
    api.terminal.open.mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const session = createProfileLoginSession(api as unknown as NativeApi, profile);
    await vi.waitFor(() => expect(api.terminal.open).toHaveBeenCalled());
    const closed = session.close();
    expect(api.terminal.close).not.toHaveBeenCalled();
    resolve({ status: "running" });
    await closed;
    expect(api.terminal.close).toHaveBeenCalledTimes(1);
    await session.close();
    expect(api.terminal.close).toHaveBeenCalledTimes(1);
  });
  it("does not launch a login after cancellation during configuration loading", async () => {
    const api = mockApi();
    let resolve!: (value: { cwd: string; homeDir: string }) => void;
    api.server.getConfig.mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const session = createProfileLoginSession(api as unknown as NativeApi, profile);
    const closed = session.close();
    resolve({ cwd: "/repo", homeDir: "/home/user" });
    await closed;
    expect(api.terminal.open).not.toHaveBeenCalled();
  });
});

describe("provider sign-in links", () => {
  it("waits for a complete CLI output line before offering its URL", () => {
    expect(
      providerSignInUrl("codex", "https://auth.openai.com/oauth/authorize?client_id=part"),
    ).toBeNull();
    expect(
      providerSignInUrl("codex", "https://auth.openai.com/oauth/authorize?client_id=complete\n"),
    ).toBe("https://auth.openai.com/oauth/authorize?client_id=complete");
  });
  it("allows only this provider's HTTPS auth host, without embedded credentials", () => {
    expect(
      providerSignInUrl("codex", "https://auth.openai.com.evil.test/oauth/authorize\n"),
    ).toBeNull();
    expect(
      providerSignInUrl("codex", "https://user:pass@auth.openai.com/oauth/authorize\n"),
    ).toBeNull();
    expect(
      providerSignInUrl("claudeAgent", "https://auth.openai.com/oauth/authorize\n"),
    ).toBeNull();
    expect(
      providerSignInUrl(
        "claudeAgent",
        "\u001b[34mhttps://claude.ai/oauth/authorize?state=test\u001b[0m\n",
      ),
    ).toBe("https://claude.ai/oauth/authorize?state=test");
  });
});
