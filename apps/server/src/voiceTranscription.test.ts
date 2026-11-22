// FILE: voiceTranscription.test.ts
// Purpose: Verifies ChatGPT-session voice transcription behavior without contacting OpenAI.
// Layer: Server test
// Exports: Vitest cases
// Depends on: voiceTranscription utility and mocked fetch responses.

import type { ServerVoiceTranscriptionInput } from "@djl/contracts";
import { describe, expect, it, vi } from "vitest";

import { transcribeVoiceWithChatGptSession, VoiceTranscriptionError } from "./voiceTranscription";

const WAV_BASE64 = Buffer.from("RIFF0000WAVE", "ascii").toString("base64");

const baseRequest: ServerVoiceTranscriptionInput = {
  provider: "codex",
  cwd: "/tmp/project",
  mimeType: "audio/wav",
  sampleRateHz: 24_000,
  durationMs: 1_000,
  audioBase64: WAV_BASE64,
};

describe("transcribeVoiceWithChatGptSession", () => {
  it("uses the ChatGPT transcription backend", async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ text: "hello" }), { status: 200 }),
    ) as unknown as typeof fetch;

    await transcribeVoiceWithChatGptSession({
      request: baseRequest,
      resolveAuth: async () => ({ token: "chatgpt-token" }),
      fetchImpl,
    });

    const [url, init] = vi.mocked(fetchImpl).mock.calls[0] ?? [];
    expect(url).toBe("https://chatgpt.com/backend-api/transcribe");
    expect((init!.body as FormData).get("model")).toBeNull();
  });

  it("refreshes the ChatGPT session once when the upload is unauthorized", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("{}", { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ text: "hello" }), { status: 200 }));
    const resolveAuth = vi.fn(async (refreshToken: boolean) => ({
      token: refreshToken ? "fresh-chatgpt-token" : "stale-chatgpt-token",
    }));

    await transcribeVoiceWithChatGptSession({
      request: baseRequest,
      resolveAuth,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(resolveAuth).toHaveBeenNthCalledWith(1, false);
    expect(resolveAuth).toHaveBeenNthCalledWith(2, true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
  it("reports HTML browser verification as a service blocker without refreshing a valid login", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response("<html>Cloudflare challenge fixture-private-body</html>", {
          status: 403,
          headers: { "content-type": "text/html" },
        }),
    );
    const resolveAuth = vi.fn(async () => ({ token: "fixture-private-token" }));
    const error = await transcribeVoiceWithChatGptSession({
      request: baseRequest,
      resolveAuth,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    }).catch((e) => e);
    expect(error).toBeInstanceOf(VoiceTranscriptionError);
    expect(error).toMatchObject({
      status: 403,
      reason: "browser-verification",
      message: expect.stringContaining("browser verification"),
    });
    expect(error.message).toContain("Retry later or supply timestamped subtitles");
    expect(error.message).not.toContain("login");
    expect(JSON.stringify(error)).not.toContain("fixture-private");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(resolveAuth).toHaveBeenCalledTimes(1);
  });
  it("distinguishes JSON expired authentication and preserves its actual status after retry", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: { code: "token_expired", message: "fixture-private-provider-body" },
          }),
          { status: 403, headers: { "content-type": "application/json" } },
        ),
    );
    const resolveAuth = vi.fn(async () => ({ token: "fixture-private-token" }));
    const error = await transcribeVoiceWithChatGptSession({
      request: baseRequest,
      resolveAuth,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    }).catch((e) => e);
    expect(error).toMatchObject({
      status: 403,
      reason: "authentication",
      message: "Your ChatGPT login has expired. Sign in again.",
    });
    expect(JSON.stringify(error)).not.toContain("fixture-private");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(resolveAuth).toHaveBeenNthCalledWith(2, true);
  });
  it("does not expose provider messages or mislabel other HTTP failures as expired login", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { message: "fixture-private-provider-body" } }), {
          status: 503,
        }),
    );
    const error = await transcribeVoiceWithChatGptSession({
      request: baseRequest,
      resolveAuth: async () => ({ token: "fixture-private-token" }),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    }).catch((e) => e);
    expect(error).toMatchObject({ status: 503, reason: "provider" });
    expect(error.message).toContain("HTTP 503");
    expect(error.message).not.toContain("expired");
    expect(JSON.stringify(error)).not.toContain("fixture-private");
  });
});
