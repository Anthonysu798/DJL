import type { FetchLike } from "../../cloud/api";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProviderSessionStartInput } from "@djl/contracts";
import { ThreadId } from "@djl/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { writeCloudSession } from "../../cloud/session";
import { createDjlCloudDriverFactory } from "./djlCloud";
import type { NativeSink } from "./types";

const sse = (events: string[]) =>
  new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const e of events) controller.enqueue(new TextEncoder().encode(e));
        controller.close();
      },
    }),
    { status: 200, headers: { "content-type": "text/event-stream" } },
  );

let secretsDir = "";
beforeEach(async () => {
  secretsDir = await mkdtemp(join(tmpdir(), "djl-cloud-driver-"));
  await writeCloudSession(secretsDir, {
    apiBaseUrl: "https://cloud.test",
    token: "sess",
    userId: "u",
    email: "e@x.y",
    orgId: "o",
    createdAt: "x",
  });
});

const start: ProviderSessionStartInput = {
  threadId: ThreadId.makeUnsafe("thread-1"),
  cwd: process.cwd(),
  runtimeMode: "approval-required",
  modelSelection: { provider: "djlCloud", model: "gpt-5-mini" },
};

function sink() {
  const events: Record<string, unknown>[] = [];
  const s: NativeSink = {
    emit: (e) => void events.push(e),
    request: async () => "cancel",
    fail: () => {},
  };
  return { s, events };
}

describe("DJL Cloud driver", () => {
  it("streams assistant text deltas, keeps history, and lists models", async () => {
    const bodies: unknown[] = [];
    const fetchImpl: FetchLike = async (input, init) => {
      const url = String(input);
      if (url.endsWith("/v1/chat/completions")) {
        bodies.push(JSON.parse(String(init?.body)));
        expect(new Headers(init?.headers).get("authorization")).toBe("Bearer sess");
        return sse([
          'data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"lo"},"finish_reason":"stop"}]}\n\n',
          'event: djl.usage\ndata: {"requestId":"r","settled":"12000","remaining":"999","cutOff":false}\n\n',
          "data: [DONE]\n\n",
        ]);
      }
      if (url.endsWith("/v1/models")) {
        return new Response(
          JSON.stringify({
            models: [
              {
                id: "gpt-5-mini",
                provider: "openai",
                displayName: "GPT-5 mini",
                capabilities: ["text.chat", "tools"],
                contextWindow: 400000,
                maxOutputTokens: 1000,
                status: "active",
              },
              {
                id: "img",
                provider: "openai",
                displayName: "Img",
                capabilities: ["image.generate"],
                contextWindow: null,
                maxOutputTokens: null,
                status: "active",
              },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response("{}", { status: 404 });
    };
    const driver = await createDjlCloudDriverFactory({ secretsDir, fetchImpl })(start, sink().s);
    const { s, events } = sink();
    const driver2 = await createDjlCloudDriverFactory({ secretsDir, fetchImpl })(start, s);
    await driver2.send({ threadId: start.threadId, input: "hi there" });
    const text = events
      .filter((e) => e.type === "content.delta")
      .map((e) => (e.payload as { delta: string }).delta)
      .join("");
    expect(text).toBe("Hello");
    expect(events.some((e) => e.type === "item.completed")).toBe(true);
    await driver2.send({ threadId: start.threadId, input: "again" });
    const second = bodies[1] as { messages: { role: string; content: string }[]; model: string };
    expect(second.model).toBe("gpt-5-mini");
    expect(second.messages.map((m) => m.role)).toEqual(["system", "user", "assistant", "user"]);
    expect(second.messages[2]?.content).toBe("Hello");
    const models = await driver.models();
    expect(models.models.map((m) => m.slug)).toEqual(["gpt-5-mini"]);
    expect(models.models[0]?.supportsToolCalls).toBe(true);
  });

  it("surfaces credit exhaustion and expired sessions as readable errors", async () => {
    const out = async (status: number, code: string) =>
      createDjlCloudDriverFactory({
        secretsDir,
        fetchImpl: async () =>
          new Response(JSON.stringify({ error: { code, message: "m", traceId: "t" } }), { status }),
      })(start, sink().s);
    await expect(
      (await out(402, "insufficient_credits")).send({ threadId: start.threadId, input: "x" }),
    ).rejects.toThrow(/out of DJL Cloud credits/);
    await expect(
      (await out(401, "unauthorized")).send({ threadId: start.threadId, input: "x" }),
    ).rejects.toThrow(/session expired/);
  });

  it("requires a stored session", async () => {
    const empty = await mkdtemp(join(tmpdir(), "djl-cloud-empty-"));
    await expect(
      createDjlCloudDriverFactory({ secretsDir: empty })(start, sink().s),
    ).rejects.toThrow(/Sign in to DJL Cloud/);
  });
});

describe("marketing chat context", () => {
  it("preserves earlier facts and releases marketing tools when the route changes", async () => {
    const bodies: { messages: { content: string }[]; tools?: unknown }[] = [];
    const fetchImpl: FetchLike = async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return sse([
        'data: {"choices":[{"delta":{"content":"Saved"},"finish_reason":"stop"}]}\n\n',
        "data: [DONE]\n\n",
      ]);
    };
    const driver = await createDjlCloudDriverFactory({ secretsDir, fetchImpl })(start, sink().s, {
      name: "local",
      url: "http://127.0.0.1:9999/mcp",
      bearerToken: "test-only",
    });
    await driver.send({ threadId: start.threadId, input: "Our room price is $199, no discount." });
    await driver.send({
      threadId: start.threadId,
      input: "Use those facts for Instagram",
      workTurnPolicy: {
        route: "marketing",
        visibleTools: ["djl_marketing_status", "djl_prepare_marketing"],
        requireSuccessfulTool: true,
        evidenceRequired: true,
        instructionScope: "authorized-root",
      },
    });
    expect(bodies[1]!.messages.some((m) => m.content.includes("$199"))).toBe(true);
    await driver.send({
      threadId: start.threadId,
      input: "Now explain binary search",
      workTurnPolicy: {
        route: "coding",
        visibleTools: [],
        requireSuccessfulTool: false,
        evidenceRequired: false,
        instructionScope: "authorized-root",
      },
    });
    expect(bodies[2]!.tools).toBeUndefined();
  });
});

it("reports a failed marketing tool as failed in the chat activity", async () => {
  let round = 0;
  const fetchImpl: FetchLike = async () => {
    round++;
    return round === 1
      ? sse([
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"failed-call","function":{"name":"djl_prepare_marketing","arguments":"{}"}}]}}]}\n\n',
          "data: [DONE]\n\n",
        ])
      : sse([
          'data: {"choices":[{"delta":{"content":"The media could not be prepared."}}]}\n\n',
          "data: [DONE]\n\n",
        ]);
  };
  const network = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(
      JSON.stringify({
        result: { isError: true, content: [{ type: "text", text: "Invalid media" }] },
      }),
    ),
  );
  try {
    const captured = sink();
    const driver = await createDjlCloudDriverFactory({ secretsDir, fetchImpl })(start, captured.s, {
      name: "scoped",
      url: "http://127.0.0.1:9999/mcp",
      bearerToken: "fixture-token",
    });
    await driver.send({
      threadId: start.threadId,
      input: "Prepare a marketing campaign",
      workTurnPolicy: {
        route: "marketing",
        visibleTools: ["djl_prepare_marketing"],
        requireSuccessfulTool: true,
        evidenceRequired: true,
        instructionScope: "authorized-root",
      },
    });
    expect(captured.events).toContainEqual(
      expect.objectContaining({
        type: "item.completed",
        payload: expect.objectContaining({ status: "failed" }),
      }),
    );
  } finally {
    network.mockRestore();
  }
});

it("keeps scoped computer tools and their results available for follow-up turns", async () => {
  const bodies: Record<string, unknown>[] = [];
  let round = 0;
  const fetchImpl: FetchLike = async (_url, init) => {
    bodies.push(JSON.parse(String(init?.body)));
    round++;
    return round % 2 === 1
      ? sse([
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"computer-call-' +
            round +
            '","function":{"name":"djl_computer_status","arguments":"{}"}}]}}]}\n\n',
          "data: [DONE]\n\n",
        ])
      : sse([
          'data: {"choices":[{"delta":{"content":"The helper reported its current capabilities."}}]}\n\n',
          "data: [DONE]\n\n",
        ]);
  };
  const network = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer thread-only-token");
    expect(JSON.parse(String(init?.body)).params).toEqual({
      name: "djl_computer_status",
      arguments: {},
    });
    return new Response(
      JSON.stringify({
        result: {
          isError: false,
          structuredContent: { method: "status", result: { available: true } },
        },
      }),
    );
  });
  try {
    const captured = sink();
    const driver = await createDjlCloudDriverFactory({ secretsDir, fetchImpl })(start, captured.s, {
      name: "local",
      url: "http://127.0.0.1:9999/mcp",
      bearerToken: "thread-only-token",
    });
    await driver.send({
      threadId: start.threadId,
      input: "Use djl_computer_status for my selected Computer Use plugin",
    });
    await driver.send({ threadId: start.threadId, input: "Check it again" });
    expect(
      (bodies[0]!.tools as { function: { name: string } }[]).map((tool) => tool.function.name),
    ).toContain("djl_computer_observe");
    expect(bodies[2]!.tools).toBeDefined();
    expect(
      (bodies[2]!.messages as { role: string }[]).some((message) => message.role === "tool"),
    ).toBe(true);
    expect(network).toHaveBeenCalledTimes(2);
  } finally {
    network.mockRestore();
  }
});

it("retries a rate-limited final reply without repeating the completed computer tool", async () => {
  const bodies: unknown[] = [];
  const fetchImpl: FetchLike = async (_url, init) => {
    bodies.push(JSON.parse(String(init?.body)));
    if (bodies.length === 1)
      return sse([
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"stop-1","function":{"name":"djl_computer_stop","arguments":"{}"}}]}}]}\n\n',
        "data: [DONE]\n\n",
      ]);
    if (bodies.length === 2)
      return new Response(
        JSON.stringify({
          error: { code: "rate_limited", message: "Too many requests. Retry in 1s." },
        }),
        { status: 429 },
      );
    return sse([
      'data: {"choices":[{"delta":{"content":"Stopped after verifying the selected text."}}]}\n\n',
      "data: [DONE]\n\n",
    ]);
  };
  const network = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(
      JSON.stringify({
        result: { structuredContent: { method: "stop", result: { stoppedSessionIds: [] } } },
      }),
    ),
  );
  vi.useFakeTimers();
  try {
    const captured = sink();
    const driver = await createDjlCloudDriverFactory({ secretsDir, fetchImpl })(start, captured.s, {
      name: "local",
      url: "http://127.0.0.1:9999/mcp",
      bearerToken: "test-only",
    });
    const result = driver.send({
      threadId: start.threadId,
      input: "Use djl_computer_status guidance and Stop",
    });
    const assertion = expect(result).resolves.toBeUndefined();
    await vi.runAllTimersAsync();
    await assertion;
    expect(network).toHaveBeenCalledTimes(1);
    expect(bodies).toHaveLength(3);
    expect(bodies[2]).toEqual(bodies[1]);
    expect(captured.events).toContainEqual(
      expect.objectContaining({
        type: "content.delta",
        payload: expect.objectContaining({ delta: "Stopped after verifying the selected text." }),
      }),
    );
  } finally {
    vi.useRealTimers();
    network.mockRestore();
  }
});

describe("DJL Cloud stream cleanup", () => {
  const controlledStream = (frame: string, eof = false) => {
    let upstream!: ReadableStreamDefaultController<Uint8Array>;
    let signal: AbortSignal | undefined;
    let aborts = 0;
    let abortsBeforeCleanup = 0;
    let cleanupStarted = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        upstream = controller;
        controller.enqueue(new TextEncoder().encode(frame));
        if (eof) controller.close();
      },
    });
    const onAbort = () => {
      aborts++;
      if (!cleanupStarted) abortsBeforeCleanup++;
      upstream.error(new DOMException("Fixture fetch aborted", "AbortError"));
    };
    const fetchImpl: FetchLike = async (_input, init) => {
      if (!init?.signal) throw new Error("Expected the owned fetch signal");
      signal = init.signal;
      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) onAbort();
      return new Response(body, { headers: { "content-type": "text/event-stream" } });
    };
    return {
      body,
      fetchImpl,
      get signal() {
        if (!signal) throw new Error("Fetch has not started");
        return signal;
      },
      get aborts() {
        return aborts;
      },
      get abortsBeforeCleanup() {
        return abortsBeforeCleanup;
      },
      dispose() {
        cleanupStarted = true;
        signal?.removeEventListener("abort", onAbort);
        upstream.error(new Error("Fixture-only failure cleanup"));
      },
    };
  };
  const delta = 'data: {"choices":[{"delta":{"content":"first"}}]}\n\n';

  it("aborts an unfinished fetch and releases its reader after malformed SSE without hiding the parse error", async () => {
    const stream = controlledStream("data: {broken\n\n");
    const driver = await createDjlCloudDriverFactory({ secretsDir, fetchImpl: stream.fetchImpl })(
      start,
      sink().s,
    );
    try {
      await expect(driver.send({ threadId: start.threadId, input: "x" })).rejects.toBeInstanceOf(
        SyntaxError,
      );
      expect(stream.signal.aborted).toBe(true);
      expect(stream.abortsBeforeCleanup).toBe(1);
      expect(stream.body.locked).toBe(false);
    } finally {
      stream.dispose();
      driver.close();
    }
  });

  it("aborts an unfinished fetch and releases its reader after a sink failure without hiding that error", async () => {
    const stream = controlledStream(delta);
    const expected = new Error("Fixture sink failed");
    const target: NativeSink = {
      ...sink().s,
      emit(event) {
        if (event.type === "content.delta") throw expected;
      },
    };
    const driver = await createDjlCloudDriverFactory({ secretsDir, fetchImpl: stream.fetchImpl })(
      start,
      target,
    );
    try {
      await expect(driver.send({ threadId: start.threadId, input: "x" })).rejects.toBe(expected);
      expect(stream.signal.aborted).toBe(true);
      expect(stream.abortsBeforeCleanup).toBe(1);
      expect(stream.body.locked).toBe(false);
    } finally {
      stream.dispose();
      driver.close();
    }
  });

  it("releases its reader without aborting a normal SSE EOF", async () => {
    const stream = controlledStream(delta + "data: [DONE]\n\n", true);
    const captured = sink();
    const driver = await createDjlCloudDriverFactory({ secretsDir, fetchImpl: stream.fetchImpl })(
      start,
      captured.s,
    );
    try {
      await driver.send({ threadId: start.threadId, input: "x" });
      expect(stream.signal.aborted).toBe(false);
      expect(stream.aborts).toBe(0);
      expect(stream.body.locked).toBe(false);
      expect(captured.events).toContainEqual(
        expect.objectContaining({
          type: "content.delta",
          payload: { streamKind: "assistant_text", delta: "first" },
        }),
      );
    } finally {
      stream.dispose();
      driver.close();
    }
  });

  it.each(["interrupt", "close"] as const)(
    "aborts and unlocks an active fetch when %s is requested",
    async (action) => {
      const stream = controlledStream(delta);
      const captured = sink();
      let sawDelta!: () => void;
      let failedBeforeDelta!: (error: unknown) => void;
      const firstDelta = new Promise<void>((resolve, reject) => {
        sawDelta = resolve;
        failedBeforeDelta = reject;
      });
      const target: NativeSink = {
        ...captured.s,
        emit(event) {
          captured.s.emit(event);
          if (event.type === "content.delta") sawDelta();
        },
      };
      const driver = await createDjlCloudDriverFactory({ secretsDir, fetchImpl: stream.fetchImpl })(
        start,
        target,
      );
      const turn = driver.send({ threadId: start.threadId, input: "x" });
      void turn.catch(failedBeforeDelta);
      try {
        await firstDelta;
        expect(stream.signal.aborted).toBe(false);
        expect(stream.body.locked).toBe(true);
        if (action === "interrupt") await driver.interrupt();
        else driver.close();
        await turn;
        expect(stream.signal.aborted).toBe(true);
        expect(stream.abortsBeforeCleanup).toBe(1);
        expect(stream.body.locked).toBe(false);
        expect(captured.events).toContainEqual({
          type: "turn.completed",
          payload: { state: "interrupted" },
        });
      } finally {
        stream.dispose();
        driver.close();
        await turn.catch(() => undefined);
      }
    },
  );
});

describe("DJL Cloud plugins", () => {
  const plugins = {
    bearerToken: "plugin-chat-token",
    servers: [{ name: "djl_linear", url: "http://127.0.0.1:9999/mcp/linear" }],
  };
  // A fake plugin gateway: initialize hands out an MCP session, tools/list answers as an event
  // stream, tools/call as JSON.
  const fakeGateway = () => {
    const calls: { method: string; params: unknown; session: string | null; url?: string }[] = [];
    const network = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe("Bearer plugin-chat-token");
      const body = JSON.parse(String(init?.body)) as {
        id?: string;
        method: string;
        params: unknown;
      };
      calls.push({
        method: body.method,
        params: body.params,
        session: headers.get("mcp-session-id"),
        ...(body.method === "initialize" ? { url: String(url) } : {}),
      });
      if (body.method === "initialize")
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: {} }), {
          headers: { "content-type": "application/json", "mcp-session-id": "mcp-1" },
        });
      if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
      if (body.method === "tools/list")
        return new Response(
          `event: message\ndata: ${JSON.stringify({
            jsonrpc: "2.0",
            id: body.id,
            result: {
              tools: [
                {
                  name: "create_issue",
                  description: "Create a Linear issue",
                  inputSchema: { type: "object", properties: { title: { type: "string" } } },
                },
              ],
            },
          })}\n\n`,
          { headers: { "content-type": "text/event-stream" } },
        );
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: { content: [{ type: "text", text: "Created ENG-1" }] },
        }),
        { headers: { "content-type": "application/json" } },
      );
    });
    return { calls, network };
  };
  const cloud = () => {
    const bodies: { tools?: { function: { name: string } }[]; messages: unknown[] }[] = [];
    const fetchImpl: FetchLike = async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return bodies.length % 2 === 1
        ? sse([
            'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","function":{"name":"djl_linear__create_issue","arguments":"{\\"title\\":\\"Bug\\"}"}}]}}]}\n\n',
            "data: [DONE]\n\n",
          ])
        : sse(['data: {"choices":[{"delta":{"content":"Done."}}]}\n\n', "data: [DONE]\n\n"]);
    };
    return { bodies, fetchImpl };
  };

  it("offers plugin tools in a plain chat and asks before running one in approval-required mode", async () => {
    const gateway = fakeGateway();
    const { bodies, fetchImpl } = cloud();
    const requests: { type: string; args: unknown }[] = [];
    const captured = sink();
    captured.s.request = async (type, args) => {
      requests.push({ type, args });
      return "accept";
    };
    try {
      const driver = await createDjlCloudDriverFactory({ secretsDir, fetchImpl })(
        start,
        captured.s,
        undefined,
        plugins,
      );
      await driver.send({
        threadId: start.threadId,
        input: "File a bug",
        djlPluginIds: ["linear"],
      });
      expect(bodies[0]!.tools?.map((tool) => tool.function.name)).toEqual([
        "djl_linear__create_issue",
      ]);
      expect(requests).toEqual([
        {
          type: "command_execution_approval",
          args: { tool: "djl_linear__create_issue", input: { title: "Bug" } },
        },
      ]);
      const call = gateway.calls.find((entry) => entry.method === "tools/call");
      expect(call).toEqual({
        method: "tools/call",
        params: { name: "create_issue", arguments: { title: "Bug" } },
        session: "mcp-1",
      });
      expect(JSON.stringify(bodies[1]!.messages)).toContain("Created ENG-1");
      expect(captured.events).toContainEqual(
        expect.objectContaining({
          type: "content.delta",
          payload: expect.objectContaining({ delta: "Done." }),
        }),
      );
    } finally {
      gateway.network.mockRestore();
    }
  });

  it("never runs a plugin tool the user declined", async () => {
    const gateway = fakeGateway();
    const { bodies, fetchImpl } = cloud();
    const captured = sink();
    captured.s.request = async () => "decline";
    try {
      const driver = await createDjlCloudDriverFactory({ secretsDir, fetchImpl })(
        start,
        captured.s,
        undefined,
        plugins,
      );
      await driver.send({
        threadId: start.threadId,
        input: "File a bug",
        djlPluginIds: ["linear"],
      });
      expect(gateway.calls.some((entry) => entry.method === "tools/call")).toBe(false);
      expect(JSON.stringify(bodies[1]!.messages)).toContain("declined");
      expect(captured.events).toContainEqual(
        expect.objectContaining({
          type: "item.completed",
          payload: expect.objectContaining({ status: "failed" }),
        }),
      );
    } finally {
      gateway.network.mockRestore();
    }
  });

  it("remembers approve-for-session and asks nothing in full-access mode", async () => {
    const gateway = fakeGateway();
    const { fetchImpl } = cloud();
    let asked = 0;
    const captured = sink();
    captured.s.request = async () => {
      asked++;
      return "acceptForSession";
    };
    try {
      const driver = await createDjlCloudDriverFactory({ secretsDir, fetchImpl })(
        start,
        captured.s,
        undefined,
        plugins,
      );
      await driver.send({
        threadId: start.threadId,
        input: "File a bug",
        djlPluginIds: ["linear"],
      });
      await driver.send({
        threadId: start.threadId,
        input: "File another",
        djlPluginIds: ["linear"],
      });
      expect(asked).toBe(1);
      const fullAccess = await createDjlCloudDriverFactory({ secretsDir, fetchImpl })(
        { ...start, runtimeMode: "full-access" },
        captured.s,
        undefined,
        plugins,
      );
      await fullAccess.send({
        threadId: start.threadId,
        input: "File a bug",
        djlPluginIds: ["linear"],
      });
      expect(asked).toBe(1);
      expect(gateway.calls.filter((entry) => entry.method === "tools/call")).toHaveLength(3);
    } finally {
      gateway.network.mockRestore();
    }
  });

  it("keeps a plain streaming chat when no plugin tool can be listed", async () => {
    const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    const bodies: { tools?: unknown }[] = [];
    const fetchImpl: FetchLike = async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return sse(['data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n', "data: [DONE]\n\n"]);
    };
    try {
      const driver = await createDjlCloudDriverFactory({ secretsDir, fetchImpl })(
        start,
        sink().s,
        undefined,
        plugins,
      );
      await driver.send({ threadId: start.threadId, input: "hello", djlPluginIds: ["linear"] });
      expect(bodies[0]!.tools).toBeUndefined();
    } finally {
      network.mockRestore();
    }
  });

  it("streams a turn without a plugin mention and never lists gateway tools", async () => {
    const gateway = fakeGateway();
    const bodies: { tools?: unknown; stream?: boolean }[] = [];
    const fetchImpl: FetchLike = async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return sse([
        'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n',
        "data: [DONE]\n\n",
      ]);
    };
    try {
      const captured = sink();
      const driver = await createDjlCloudDriverFactory({ secretsDir, fetchImpl })(
        start,
        captured.s,
        undefined,
        plugins,
      );
      await driver.send({ threadId: start.threadId, input: "hello" });
      expect(gateway.calls).toEqual([]);
      expect(bodies[0]!.tools).toBeUndefined();
      expect(bodies[0]!.stream).toBe(true);
      expect(
        captured.events
          .filter((event) => event.type === "content.delta")
          .map((event) => (event.payload as { delta: string }).delta),
      ).toEqual(["Hel", "lo"]);
    } finally {
      gateway.network.mockRestore();
    }
  });

  it("offers only the mentioned plugin's tools", async () => {
    const gateway = fakeGateway();
    const { bodies, fetchImpl } = cloud();
    try {
      const driver = await createDjlCloudDriverFactory({ secretsDir, fetchImpl })(
        { ...start, runtimeMode: "full-access" },
        sink().s,
        undefined,
        {
          bearerToken: "plugin-chat-token",
          servers: [
            { name: "djl_linear", url: "http://127.0.0.1:9999/mcp/linear", pluginId: "linear" },
            { name: "djl_notion", url: "http://127.0.0.1:9999/mcp/notion", pluginId: "notion" },
            // Its id starts with "linear_", but it is a different plugin.
            {
              name: "djl_linear_extra",
              url: "http://127.0.0.1:9999/mcp/linear_extra",
              pluginId: "linear_extra",
            },
          ],
        },
      );
      await driver.send({
        threadId: start.threadId,
        input: "File a bug",
        djlPluginIds: ["linear"],
      });
      expect(bodies[0]!.tools?.map((tool) => tool.function.name)).toEqual([
        "djl_linear__create_issue",
      ]);
      const contacted = gateway.calls.flatMap((call) => (call.url ? [call.url] : []));
      expect(contacted.length).toBeGreaterThan(0);
      expect(contacted.every((url) => url.endsWith("/mcp/linear"))).toBe(true);
    } finally {
      gateway.network.mockRestore();
    }
  });
});
