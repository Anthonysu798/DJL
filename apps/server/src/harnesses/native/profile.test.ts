import {
  DEFAULT_SERVER_SETTINGS,
  ThreadId,
  type ProviderSessionStartInput,
} from "@synara/contracts";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { buildHarnessInvocation } from "../accounts";
import { ServerSettingsService } from "../../serverSettings";
import { makeConfiguredNativeAdapter } from "./layer";
import { nativeProfileOptions } from "./profile";
import { codexPermissions } from "./codex";
import type { NativeDriverFactory } from "./types";

const profileA = { binaryPath: "/custom/account-a/codex", homePath: "/custom/account-a/home" };
const profileB = { binaryPath: "/custom/account-b/codex", homePath: "/custom/account-b/home" };

describe("server-authoritative native runtime profiles", () => {
  it("uses the Accounts profile for discovery/chat and retains it through recovery after settings change", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const settings = yield* ServerSettingsService;
          const calls: ProviderSessionStartInput[] = [];
          const factory: NativeDriverFactory = async (input) => {
            calls.push(input);
            return {
              id: "native-session",
              send: async () => new Promise<void>(() => {}),
              close: () => {},
              interrupt: async () => {},
              models: async () => ({ models: [{ slug: "native", name: "Native" }] }),
            };
          };
          const adapter = yield* makeConfiguredNativeAdapter("codex", factory);
          const account = buildHarnessInvocation(
            "codex",
            yield* settings.getSettings,
            "/managed",
            {},
          );
          yield* adapter.listModels!({ provider: "codex", cwd: "/tmp" });
          expect(calls[0]?.providerOptions?.codex).toEqual({
            binaryPath: account.binary,
            homePath: account.env.CODEX_HOME,
          });
          const threadId = ThreadId.makeUnsafe("configured-profile");
          const session = yield* adapter.startSession({
            threadId,
            cwd: "/tmp",
            runtimeMode: "full-access",
            approvalPolicy: "on-request",
            sandboxMode: "read-only",
          });
          expect(calls[1]?.providerOptions?.codex).toEqual(profileA);
          yield* settings.updateSettings({ providers: { codex: profileB } });
          yield* adapter.listModels!({ provider: "codex", cwd: "/tmp" });
          expect(calls[2]?.providerOptions?.codex).toEqual(profileB);
          yield* adapter.sendTurn({ threadId, input: "hello" });
          yield* adapter.interruptTurn(threadId);
          const restarted = yield* makeConfiguredNativeAdapter("codex", factory);
          yield* restarted.startSession({
            threadId,
            cwd: "/tmp",
            runtimeMode: "full-access",
            resumeCursor: JSON.parse(JSON.stringify(session.resumeCursor)),
          });
          expect(calls[3]?.providerOptions?.codex).toEqual(profileA);
          expect(codexPermissions(calls[3]!)).toEqual({
            approvalsReviewer: "user",
            approvalPolicy: "on-request",
            sandbox: "read-only",
          });
          yield* restarted.listModels!({ provider: "codex", cwd: "/tmp", ...profileA });
          expect(calls).toHaveLength(4); // The matching profile is reusable; account B was not reused.
        }),
      ).pipe(Effect.provide(ServerSettingsService.layerTest({ providers: { codex: profileA } }))),
    );
  });

  it("resolves configured Claude and Cursor paths without changing credential ownership", () => {
    const settings = {
      ...DEFAULT_SERVER_SETTINGS,
      providers: {
        ...DEFAULT_SERVER_SETTINGS.providers,
        claudeAgent: {
          ...DEFAULT_SERVER_SETTINGS.providers.claudeAgent,
          binaryPath: "/custom/claude",
        },
        cursor: {
          ...DEFAULT_SERVER_SETTINGS.providers.cursor,
          binaryPath: "/custom/cursor",
          apiEndpoint: "https://cursor.example",
        },
      },
    };
    expect(nativeProfileOptions("claudeAgent", settings)).toEqual({
      claudeAgent: { binaryPath: "/custom/claude" },
    });
    expect(nativeProfileOptions("cursor", settings)).toEqual({
      cursor: { binaryPath: "/custom/cursor", apiEndpoint: "https://cursor.example" },
    });
  });
});
