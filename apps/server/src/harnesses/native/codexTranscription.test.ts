import type { ServerVoiceTranscriptionInput } from "@synara/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  auth: [] as Record<string, unknown>[],
  calls: [] as { method: string; params: unknown }[],
  launches: [] as { binary: string; args: string[]; cwd: string; home: string | undefined }[],
  notifications: [] as string[],
  closed: 0,
  failMethod: "",
}));
vi.mock("./protocol", async (original) => ({
  ...(await original<typeof import("./protocol")>()),
  NativeRpc: class {
    constructor(binary: string, args: string[], cwd: string, env?: NodeJS.ProcessEnv) {
      state.launches.push({ binary, args, cwd, home: env?.CODEX_HOME });
    }
    async request(method: string, params: unknown) {
      state.calls.push({ method, params });
      if (method === state.failMethod) throw new Error("Fixture protocol failure");
      return method === "getAuthStatus" ? (state.auth.shift() ?? {}) : {};
    }
    notify(method: string) {
      state.notifications.push(method);
    }
    close() {
      state.closed++;
    }
  },
}));
import { transcribeNativeCodexVoice } from "./codexTranscription";
const request: ServerVoiceTranscriptionInput = {
  provider: "codex",
  cwd: "/tmp/workspace",
  mimeType: "audio/wav",
  sampleRateHz: 24000,
  durationMs: 1000,
  audioBase64: Buffer.from("RIFF0000WAVE").toString("base64"),
};
const profile = {
  codex: { binaryPath: "/configured/codex", homePath: "/configured/account-home" },
};
beforeEach(() => {
  state.auth = [];
  state.calls = [];
  state.launches = [];
  state.notifications = [];
  state.closed = 0;
  state.failMethod = "";
});
describe("native Codex voice transcription", () => {
  it("uses the configured native account, returns transcript text only and closes the discovery RPC", async () => {
    state.auth = [{ authMethod: "chatgpt", authToken: "fixture-private-token" }];
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ text: "Verified spoken words" }), { status: 200 }),
    );
    const result = await transcribeNativeCodexVoice(
      request,
      profile,
      fetchImpl as unknown as typeof fetch,
    );
    expect(result).toEqual({ text: "Verified spoken words" });
    expect(JSON.stringify(result)).not.toContain("fixture-private-token");
    expect(state.launches).toEqual([
      {
        binary: "/configured/codex",
        args: ["app-server"],
        cwd: request.cwd,
        home: "/configured/account-home",
      },
    ]);
    expect(state.calls).toEqual([
      {
        method: "initialize",
        params: { clientInfo: { name: "djl_voice", title: "DJL", version: "1.0.0" } },
      },
      { method: "getAuthStatus", params: { includeToken: true, refreshToken: false } },
    ]);
    expect(state.notifications).toEqual(["initialized"]);
    expect(state.closed).toBe(1);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://chatgpt.com/backend-api/transcribe",
      expect.objectContaining({ headers: { Authorization: "Bearer fixture-private-token" } }),
    );
  });
  it("refreshes missing auth once and accepts ChatGPT token sessions", async () => {
    state.auth = [
      { authMethod: "chatgpt" },
      { authMethod: "chatgptAuthTokens", authToken: "fixture-fresh-token" },
    ];
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ text: "Refreshed words" }), { status: 200 }),
    );
    await transcribeNativeCodexVoice(request, profile, fetchImpl as unknown as typeof fetch);
    expect(state.calls.filter((c) => c.method === "getAuthStatus").map((c) => c.params)).toEqual([
      { includeToken: true, refreshToken: false },
      { includeToken: true, refreshToken: true },
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(state.closed).toBe(1);
  });
  it("refreshes the provider login on an unauthorized upload using the same disposable RPC", async () => {
    state.auth = [
      { authMethod: "chatgpt", authToken: "fixture-old-token" },
      { authMethod: "chatgpt", authToken: "fixture-new-token" },
    ];
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("{}", { status: 401 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ text: "Retried words" }), { status: 200 }),
      );
    expect(
      await transcribeNativeCodexVoice(request, profile, fetchImpl as unknown as typeof fetch),
    ).toEqual({
      text: "Retried words",
    });
    expect(state.calls.filter((c) => c.method === "getAuthStatus").map((c) => c.params)).toEqual([
      { includeToken: true, refreshToken: false },
      { includeToken: true, refreshToken: true },
    ]);
    expect(state.launches).toHaveLength(1);
    expect(state.closed).toBe(1);
  });
  it("rejects absent and API-key authentication without uploading audio, then disposes discovery", async () => {
    const fetchImpl = vi.fn();
    state.auth = [{ authMethod: "apikey", authToken: "fixture-api-key" }];
    await expect(
      transcribeNativeCodexVoice(request, profile, fetchImpl as unknown as typeof fetch),
    ).rejects.toThrow(/ChatGPT-authenticated/);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(state.closed).toBe(1);
    state.auth = [{}, {}];
    await expect(
      transcribeNativeCodexVoice(request, profile, fetchImpl as unknown as typeof fetch),
    ).rejects.toThrow(/Sign in/);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(state.closed).toBe(2);
  });
  it("disposes discovery on RPC and upload failure and never spawns for invalid audio", async () => {
    const fetchImpl = vi.fn();
    state.failMethod = "initialize";
    await expect(
      transcribeNativeCodexVoice(request, profile, fetchImpl as unknown as typeof fetch),
    ).rejects.toThrow();
    expect(state.closed).toBe(1);
    expect(fetchImpl).not.toHaveBeenCalled();
    state.failMethod = "";
    state.auth = [{ authMethod: "chatgpt", authToken: "fixture-token" }];
    fetchImpl.mockRejectedValueOnce(new Error("Fixture network failure"));
    await expect(
      transcribeNativeCodexVoice(request, profile, fetchImpl as unknown as typeof fetch),
    ).rejects.toThrow(/network failure/);
    expect(state.closed).toBe(2);
    await expect(
      transcribeNativeCodexVoice(
        { ...request, sampleRateHz: 16000 },
        profile,
        fetchImpl as unknown as typeof fetch,
      ),
    ).rejects.toThrow(/24 kHz/);
    expect(state.launches).toHaveLength(2);
  });
});
