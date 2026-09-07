import { describe, expect, it } from "vitest";
import { Schema } from "effect";
import { NewTaskModelSelection, NewTaskProviderStartOptions } from "./orchestration";
import { HarnessLoginInput } from "./harnessAccounts";

describe("fresh harness command contracts", () => {
  it.each(["codex", "claudeAgent", "cursor", "opencode"])(
    "accepts %s for a new chat turn",
    (provider) => {
      expect(
        Schema.decodeUnknownSync(NewTaskModelSelection)({ provider, model: "test-model" }).provider,
      ).toBe(provider);
    },
  );
  it("keeps historical runtimes without a new implementation out of new chat turns", () => {
    expect(() =>
      Schema.decodeUnknownSync(NewTaskModelSelection)({ provider: "grok", model: "test-model" }),
    ).toThrow();
  });
  it("rejects arbitrary executable names as login harness IDs", () => {
    expect(() => Schema.decodeUnknownSync(HarnessLoginInput)({ harness: "/bin/sh" })).toThrow();
  });
  it("accepts native runtime options on new turns", () => {
    expect(
      Schema.decodeUnknownSync(NewTaskProviderStartOptions)({
        codex: { binaryPath: "/opt/codex", homePath: "/tmp/codex-profile" },
      }),
    ).toEqual({ codex: { binaryPath: "/opt/codex", homePath: "/tmp/codex-profile" } });
  });
});
