import { ThreadId } from "@synara/contracts";
import { describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  options: undefined as Record<string, unknown> | undefined,
  closed: 0,
  resultError: "",
  multipleMessages: false,
  reportUsage: false,
  actualMode: "",
  permissionDenied: false,
  modes: [] as string[],
  flags: [] as Record<string, unknown>[],
}));
vi.mock("./claudeExecutable", () => ({ resolveClaudeExecutable: async () => "/resolved/claude" }));
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: ({
    prompt,
    options,
  }: {
    prompt: AsyncIterable<unknown>;
    options: Record<string, unknown>;
  }) => {
    state.options = options;
    const iterator = (async function* () {
      for await (const _message of prompt) {
        if (state.permissionDenied)
          yield {
            type: "system",
            subtype: "permission_denied",
            tool_name: "Bash",
            tool_use_id: "denied",
            decision_reason_type: "classifier",
            decision_reason: "Outside approved scope",
            message: "Tool denied",
          };
        if (state.actualMode)
          yield { type: "system", subtype: "init", permissionMode: state.actualMode };
        if (state.reportUsage)
          yield {
            type: "stream_event",
            event: {
              type: "message_start",
              message: {
                id: "usage-message",
                model: "claude-fable-5-1",
                usage: {
                  input_tokens: 100,
                  cache_read_input_tokens: 8000,
                  cache_creation_input_tokens: 2000,
                  output_tokens: 0,
                },
              },
            },
          };
        if (state.reportUsage)
          yield {
            type: "stream_event",
            event: { type: "message_delta", usage: { output_tokens: 400 } },
          };
        yield {
          type: "stream_event",
          event: {
            type: "content_block_delta",
            index: 0,
            delta: { type: "text_delta", text: "native response" },
          },
        };
        if (state.multipleMessages) {
          yield {
            type: "stream_event",
            event: { type: "message_start", message: { id: "second-native-message" } },
          };
          for (const text of ["second ", "message"])
            yield {
              type: "stream_event",
              event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
            };
        }
        yield {
          type: "assistant",
          message: {
            content: [
              { type: "tool_use", id: "tool-1", name: "Read", input: { file_path: "/tmp/file" } },
            ],
          },
        };
        yield {
          type: "user",
          message: { content: [{ type: "tool_result", tool_use_id: "tool-1", content: "result" }] },
        };
        yield {
          type: "result",
          subtype: "success",
          is_error: Boolean(state.resultError),
          result: state.resultError,
          ...(state.reportUsage
            ? {
                modelUsage: { "claude-fable-5-1": { contextWindow: 1000000, inputTokens: 999999 } },
              }
            : {}),
        };
      }
    })();
    return Object.assign(iterator, {
      initializationResult: async () => ({}),
      setPermissionMode: async (mode: string) => {
        state.modes.push(mode);
      },
      setModel: async () => {},
      applyFlagSettings: async (settings: Record<string, unknown>) => {
        state.flags.push(settings);
      },
      supportedModels: async () => [{ value: "native", displayName: "Native" }],
      interrupt: async () => {},
      close: () => {
        state.closed++;
      },
    });
  },
}));
import { createClaudeDriver } from "./claude";
const input = {
  threadId: ThreadId.makeUnsafe("claude-test"),
  cwd: "/tmp",
  runtimeMode: "approval-required" as const,
};

describe("fresh Claude SDK bridge", () => {
  it("applies Ultracode at startup and reports the latest context including cache hits", async () => {
    state.reportUsage = true;
    const events: Record<string, unknown>[] = [];
    const driver = await createClaudeDriver(
      {
        ...input,
        modelSelection: {
          provider: "claudeAgent",
          model: "claude-fable-5-1",
          options: { effort: "ultracode" },
        },
      },
      { emit: (event) => events.push(event), request: async () => "cancel", fail: () => {} },
    );
    try {
      expect(state.options?.effort).toBe("xhigh");
      expect(state.options?.settings).toMatchObject({ ultracode: true, autoCompactWindow: 200000 });
      await driver.send({ threadId: input.threadId, input: "hello" });
      expect(events).toContainEqual({
        type: "thread.token-usage.updated",
        payload: {
          usage: expect.objectContaining({
            usedTokens: 10500,
            inputTokens: 10100,
            outputTokens: 400,
            maxTokens: 1000000,
          }),
        },
      });
    } finally {
      state.reportUsage = false;
      driver.close();
    }
  });

  it.each(["low", "max"] as const)(
    "applies %s effort and changes compaction without restarting",
    async (effort) => {
      const driver = await createClaudeDriver(
        {
          ...input,
          modelSelection: {
            provider: "claudeAgent",
            model: "claude-fable-5-1",
            options: { effort },
          },
        },
        { emit: () => {}, request: async () => "cancel", fail: () => {} },
      );
      try {
        expect(state.options?.effort).toBe(effort);
        await driver.send({
          threadId: input.threadId,
          input: "hi",
          modelSelection: {
            provider: "claudeAgent",
            model: "claude-fable-5-1",
            options: { effort, autoCompactWindow: "1m" },
          },
        });
        expect(state.flags.at(-1)).toEqual({ autoCompactWindow: 1000000 });
      } finally {
        driver.close();
      }
    },
  );

  it.each([
    ["approval-required", "default"],
    ["full-access", "default"],
    ["accept-edits", "acceptEdits"],
    ["auto-approval", "auto"],
    ["bypass-permissions", "bypassPermissions"],
  ] as const)("maps %s to native %s without bypassing Auto", async (runtimeMode, mode) => {
    const driver = await createClaudeDriver(
      { ...input, runtimeMode },
      { emit: () => {}, request: async () => "cancel", fail: () => {} },
    );
    try {
      expect(state.options?.permissionMode).toBe(mode);
      expect(state.options?.allowDangerouslySkipPermissions === true).toBe(
        mode === "bypassPermissions",
      );
    } finally {
      driver.close();
    }
  });

  it("rejects native fallback instead of claiming Auto is active", async () => {
    state.actualMode = "default";
    const driver = await createClaudeDriver(
      { ...input, runtimeMode: "auto-approval" },
      { emit: () => {}, request: async () => "cancel", fail: () => {} },
    );
    try {
      await expect(driver.send({ threadId: input.threadId, input: "hi" })).rejects.toThrow(
        "permission mode auto is unavailable",
      );
    } finally {
      state.actualMode = "";
      driver.close();
    }
  });

  it("keeps questions interactive in bypass and restores the mode after Plan", async () => {
    const request = vi.fn(async (_type: string, _args: unknown) => ({ Color: ["Blue"] }));
    const driver = await createClaudeDriver(
      { ...input, runtimeMode: "bypass-permissions" },
      { emit: () => {}, request, fail: () => {} },
    );
    try {
      const callback = state.options!.canUseTool as (
        name: string,
        args: Record<string, unknown>,
        context: { toolUseID: string; signal: AbortSignal },
      ) => Promise<Record<string, unknown>>;
      expect(
        await callback(
          "AskUserQuestion",
          { questions: [] },
          { toolUseID: "question", signal: new AbortController().signal },
        ),
      ).toMatchObject({ behavior: "allow", updatedInput: { answers: { Color: "Blue" } } });
      expect(request.mock.calls[0]?.[0]).toBe("tool_user_input");
      await driver.send({ threadId: input.threadId, input: "plan", interactionMode: "plan" });
      expect(state.modes.at(-1)).toBe("plan");
      await driver.send({
        threadId: input.threadId,
        input: "continue",
        interactionMode: "default",
      });
      expect(state.modes.at(-1)).toBe("bypassPermissions");
    } finally {
      driver.close();
    }
  });

  it("preserves Claude classifier denials and their reasons", async () => {
    state.permissionDenied = true;
    const events: Record<string, unknown>[] = [];
    const driver = await createClaudeDriver(
      { ...input, runtimeMode: "auto-approval" },
      { emit: (event) => events.push(event), request: async () => "cancel", fail: () => {} },
    );
    try {
      await driver.send({ threadId: input.threadId, input: "hi" });
      expect(events).toContainEqual({
        type: "item.completed",
        itemId: "permission-denied",
        payload: expect.objectContaining({ status: "declined", detail: "Outside approved scope" }),
      });
    } finally {
      state.permissionDenied = false;
      driver.close();
    }
  });

  it("rejects a conflicting override instead of labeling default mode as Auto", async () => {
    await expect(
      createClaudeDriver(
        {
          ...input,
          runtimeMode: "auto-approval",
          providerOptions: { claudeAgent: { permissionMode: "default" } },
        },
        { emit: () => {}, request: async () => "cancel", fail: () => {} },
      ),
    ).rejects.toThrow("Conflicting Claude permission settings");
  });

  it("keeps separate native assistant messages distinct while retaining chunk identity", async () => {
    state.multipleMessages = true;
    const events: Record<string, unknown>[] = [];
    const driver = await createClaudeDriver(input, {
      emit: (event) => events.push(event),
      request: async () => "cancel",
      fail: () => {},
    });
    try {
      await driver.send({ threadId: input.threadId, input: "hello" });
      const deltas = events.filter((event) => event.type === "content.delta");
      expect(deltas).toHaveLength(3);
      expect(deltas[0]!.itemId).not.toBe(deltas[1]!.itemId);
      expect(deltas[1]!.itemId).toBe(deltas[2]!.itemId);
    } finally {
      driver.close();
      state.multipleMessages = false;
    }
  });

  it("preserves native resume, streams text and tool lifecycle, never bypasses permissions", async () => {
    const events: Record<string, unknown>[] = [];
    const driver = await createClaudeDriver(
      { ...input, resumeCursor: { nativeSessionId: "native-claude-session" } },
      { emit: (event) => events.push(event), request: async () => "decline", fail: () => {} },
    );
    try {
      expect(state.options?.pathToClaudeCodeExecutable).toBe("/resolved/claude");
      expect(state.options?.resume).toBe("native-claude-session");
      expect(state.options?.permissionMode).toBe("default");
      expect(state.options?.allowDangerouslySkipPermissions).toBeUndefined();
      await driver.send({ threadId: input.threadId, input: "hello" });
      expect(events.map((event) => event.type)).toEqual([
        "content.delta",
        "item.started",
        "item.completed",
      ]);
      expect((await driver.models()).models).toEqual([{ slug: "native", name: "Native" }]);
      const request = state.options!.canUseTool as (
        name: string,
        args: Record<string, unknown>,
        context: { toolUseID: string; signal: AbortSignal },
      ) => Promise<Record<string, unknown>>;
      expect(
        await request(
          "Bash",
          { command: "echo test" },
          { toolUseID: "pending", signal: new AbortController().signal },
        ),
      ).toMatchObject({ behavior: "deny" });
    } finally {
      driver.close();
    }
    expect(state.closed).toBeGreaterThan(0);
  });
  it("surfaces an expired native OAuth session as a failed turn", async () => {
    state.resultError = "Failed to authenticate: OAuth session expired and could not be refreshed";
    const driver = await createClaudeDriver(input, {
      emit: () => {},
      request: async () => "cancel",
      fail: () => {},
    });
    try {
      await expect(driver.send({ threadId: input.threadId, input: "hello" })).rejects.toThrow(
        "OAuth session expired",
      );
    } finally {
      driver.close();
      state.resultError = "";
    }
  });

  it("refuses a sandbox requirement it cannot enforce", async () => {
    await expect(
      createClaudeDriver(
        { ...input, sandboxMode: "read-only" },
        { emit: () => {}, request: async () => "cancel", fail: () => {} },
      ),
    ).rejects.toThrow("OS sandbox");
  });
});
