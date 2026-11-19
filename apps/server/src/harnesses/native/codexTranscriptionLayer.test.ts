import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import type { ServerVoiceTranscriptionInput, ProviderStartOptions } from "@synara/contracts";
const transcribe = vi.hoisted(() => vi.fn());
vi.mock("./codexTranscription", () => ({ transcribeNativeCodexVoice: transcribe }));
import { makeConfiguredNativeAdapter } from "./layer";
import { ServerSettingsService } from "../../serverSettings";
import type { NativeDriverFactory } from "./types";
const factory: NativeDriverFactory = async () => {
  throw new Error("Transcription must not create a chat session");
};
const request: ServerVoiceTranscriptionInput = {
  provider: "codex",
  cwd: "/tmp/project",
  mimeType: "audio/wav",
  sampleRateHz: 24000,
  durationMs: 1000,
  audioBase64: "UklGRjAwMDBXQVZF",
};
describe("configured native transcription capability", () => {
  it("exposes Codex transcription and reads the current server-owned account settings", async () => {
    transcribe.mockResolvedValue({ text: "Words" });
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const settings = yield* ServerSettingsService;
          const adapter = yield* makeConfiguredNativeAdapter("codex", factory);
          expect(adapter.transcribeVoice).toBeTypeOf("function");
          expect(yield* adapter.transcribeVoice!(request)).toEqual({ text: "Words" });
          expect(transcribe).toHaveBeenLastCalledWith(request, {
            codex: { binaryPath: "/account-a/codex", homePath: "/account-a/home" },
          } satisfies ProviderStartOptions);
          yield* settings.updateSettings({
            providers: { codex: { binaryPath: "/account-b/codex", homePath: "/account-b/home" } },
          });
          yield* adapter.transcribeVoice!(request);
          expect(transcribe).toHaveBeenLastCalledWith(request, {
            codex: { binaryPath: "/account-b/codex", homePath: "/account-b/home" },
          } satisfies ProviderStartOptions);
          const other = yield* makeConfiguredNativeAdapter("claudeAgent", factory);
          expect(other.transcribeVoice).toBeUndefined();
          transcribe.mockRejectedValueOnce(new Error("Sign in to ChatGPT in Codex."));
          const error = yield* adapter.transcribeVoice!(request).pipe(Effect.flip);
          expect(error).toMatchObject({
            provider: "codex",
            method: "transcribeVoice",
            detail: "Sign in to ChatGPT in Codex.",
          });
        }),
      ).pipe(
        Effect.provide(
          ServerSettingsService.layerTest({
            providers: { codex: { binaryPath: "/account-a/codex", homePath: "/account-a/home" } },
          }),
        ),
      ),
    );
  });
});
