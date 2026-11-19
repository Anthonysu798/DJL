import { beforeEach, describe, expect, it, vi } from "vitest";
import { isComputerActivityHistoryAuthorized } from "./computerTurnLifecycle";

vi.mock("./computerTurnLifecycle", () => ({
  isComputerActivityHistoryAuthorized: vi.fn(() => true),
}));

import {
  COMPUTER_TOOLS,
  computerToolMcpResult,
  createDesktopComputerClient,
  executeComputerTool,
} from "./computerTools";

const scope = { threadId: "thread-a" };
const target = { bundleId: "dev.djl.fixture", pid: 42, windowId: 7 };
const session = { sessionId: "session-a", threadId: scope.threadId, target };
const observation = {
  sessionId: session.sessionId,
  snapshotId: "snapshot-a",
  target,
  capturedAt: "2026-10-28T12:00:00Z",
  bounds: { x: 0, y: 0, width: 500, height: 400 },
  elements: [],
  truncated: false,
};
const unavailable = {
  method: "status",
  result: {
    platform: "darwin",
    available: false,
    permissions: { accessibility: "denied", screenRecording: "denied" },
    capabilities: {
      observation: false,
      screenshots: false,
      backgroundActions: [],
      virtualCursor: false,
      passiveHistory: false,
    },
  },
};
const url = "http://127.0.0.1:43210/computer-use";
const token = "private-desktop-token";
function fixture(...responses: unknown[]) {
  const fetch = vi.fn<typeof globalThis.fetch>();
  for (const response of responses) fetch.mockResolvedValueOnce(Response.json(response));
  return { fetch, client: createDesktopComputerClient({ url, token, fetch }) };
}

describe("computer tools", () => {
  beforeEach(() => vi.mocked(isComputerActivityHistoryAuthorized).mockReturnValue(true));
  it("adapts native errors and malformed responses into MCP errors", () => {
    expect(
      computerToolMcpResult({
        method: "status",
        error: { code: "permission-denied", message: token },
      }),
    ).toMatchObject({ isError: true, structuredContent: { error: { code: "permission-denied" } } });
    expect(
      JSON.stringify(
        computerToolMcpResult({
          method: "status",
          error: { code: "permission-denied", message: token },
        }),
      ),
    ).not.toContain(token);
    expect(computerToolMcpResult({ method: "status", result: { available: true } })).toMatchObject({
      isError: true,
    });
    expect(computerToolMcpResult(unavailable)).toMatchObject({
      isError: false,
      structuredContent: unavailable,
    });
  });

  it.each(["clipboard-conflict", "clipboard-restore-failed"])(
    "keeps %s distinct without forwarding native error content",
    (code) => {
      const result = computerToolMcpResult({
        method: "session.perform",
        error: { code, message: "synthetic-input-must-not-leak" },
      });
      expect(result).toMatchObject({ isError: true, structuredContent: { error: { code } } });
      expect(JSON.stringify(result)).not.toContain("synthetic-input-must-not-leak");
    },
  );

  it.each(["text", "md", "html"])(
    "forwards explicit %s paste with trusted chat identity",
    async (format) => {
      const result = {
        method: "session.perform",
        result: { acknowledgement: "dispatched", effect: "unverified" },
      };
      const { client, fetch } = fixture({ method: "session.open", result: session }, result);
      await executeComputerTool(scope, "djl_computer_open", { target }, { client });
      const action = {
        type: "paste",
        target: { kind: "element", snapshotId: "snapshot-a", elementId: 1 },
        text: "Synthetic café ✓",
        format,
      };
      expect(
        await executeComputerTool(
          scope,
          "djl_computer_action",
          { sessionId: session.sessionId, action },
          { client },
        ),
      ).toEqual(result);
      expect(JSON.parse(fetch.mock.calls[1]![1]?.body as string)).toEqual({
        threadId: scope.threadId,
        request: { method: "session.perform", sessionId: session.sessionId, action },
      });
    },
  );

  it.each(["session.observe", "session.perform"])(
    "emits %s screenshots as MCP images without base64 in text",
    (method) => {
      const screenshot = {
        mimeType: "image/png",
        width: 5,
        height: 4,
        payload: { kind: "data", base64: "YWJjZA==" },
      };
      const observed = { ...observation, screenshot };
      const result = computerToolMcpResult({
        method,
        result:
          method === "session.observe"
            ? observed
            : { acknowledgement: "dispatched", effect: "observed-change", observation: observed },
      });
      expect(result).toMatchObject({
        isError: false,
        content: [{ type: "text" }, { type: "image", mimeType: "image/png", data: "YWJjZA==" }],
      });
      expect(JSON.stringify((result.content as Array<unknown>)[0])).not.toContain("YWJjZA==");
      expect(JSON.stringify(result.structuredContent)).not.toContain("YWJjZA==");
    },
  );

  it("forwards selection through the trusted chat bridge and retains range readback", async () => {
    const result = {
      method: "session.perform",
      result: { acknowledgement: "dispatched", effect: "unverified" },
    };
    const { client, fetch } = fixture({ method: "session.open", result: session }, result);
    await executeComputerTool(scope, "djl_computer_open", { target }, { client });
    const action = {
      type: "selectText",
      target: { kind: "element", snapshotId: "snapshot-a", elementId: 1 },
      text: "café 🧪",
      selection: "cursor_after",
    };
    expect(
      await executeComputerTool(
        scope,
        "djl_computer_action",
        { sessionId: session.sessionId, action },
        { client },
      ),
    ).toEqual(result);
    expect(JSON.parse(fetch.mock.calls[1]![1]?.body as string)).toEqual({
      threadId: scope.threadId,
      request: { method: "session.perform", sessionId: session.sessionId, action },
    });
    const observed = {
      method: "session.observe",
      result: {
        ...observation,
        elements: [
          {
            elementId: 1,
            role: "AXTextField",
            label: "Draft",
            actions: [],
            selectedTextRange: { location: 10, length: 0 },
          },
        ],
      },
    };
    expect(computerToolMcpResult(observed)).toMatchObject({
      isError: false,
      structuredContent: observed,
    });
  });

  it("retains reference screenshots as text metadata without inventing image availability", () => {
    const screenshot = {
      mimeType: "image/jpeg",
      width: 5,
      height: 4,
      payload: { kind: "reference", id: "image-ref" },
    };
    const response = { method: "session.observe", result: { ...observation, screenshot } };
    const result = computerToolMcpResult(response);
    expect(result).toMatchObject({ isError: false, structuredContent: response });
    expect(result.content).toHaveLength(1);
    expect(JSON.stringify(response)).toContain("image-ref");
  });

  it("advertises only scoped tools, strict inputs and consequential actions", () => {
    expect(COMPUTER_TOOLS.map((tool) => tool.name)).toEqual([
      "djl_computer_status",
      "djl_computer_apps",
      "djl_computer_open",
      "djl_computer_observe",
      "djl_computer_action",
      "djl_computer_stop",
      "djl_computer_history",
      "djl_computer_activity",
    ]);
    for (const tool of COMPUTER_TOOLS) {
      expect(tool.inputSchema.type).toBe("object");
      expect(tool.inputSchema.additionalProperties).toBe(false);
    }
    for (const name of ["djl_computer_status", "djl_computer_apps"]) {
      const schema = COMPUTER_TOOLS.find((tool) => tool.name === name)!.inputSchema;
      expect(schema.properties).toEqual({});
      expect(schema).not.toHaveProperty("anyOf");
    }
    expect(COMPUTER_TOOLS.find((tool) => tool.name === "djl_computer_action")?._meta).toEqual({
      "djl/tool-classification": "external",
    });
  });

  it.each([
    ["djl_computer_status", { threadId: "thread-b" }],
    ["djl_computer_status", { url, token }],
    ["djl_computer_status", { method: "apps.list" }],
    ["djl_computer_open", { target: { ...target, threadId: "thread-b" } }],
    ["djl_computer_history", { source: "passive" }],
    ["djl_computer_history", { limit: 201 }],
    ["djl_computer_activity", { allowActivityHistory: true }],
    ["djl_computer_activity", { threadId: "thread-b" }],
    ["djl_computer_activity", { method: "activity.capture" }],
    ["djl_computer_activity", { source: "passive" }],
    ["djl_computer_activity", { limit: 201 }],
    ["djl_computer_activity", { since: "yesterday" }],
    [
      "djl_computer_activity",
      { since: "2026-10-29T00:00:00.000Z", until: "2026-10-28T00:00:00.000Z" },
    ],
    [
      "djl_computer_action",
      {
        sessionId: "s",
        action: { type: "type", target: { kind: "point", x: NaN, y: 1 }, text: "secret-input" },
      },
    ],
  ])("rejects spoofed or malformed %s arguments without dispatch", async (name, args) => {
    const { client, fetch } = fixture();
    const result = await executeComputerTool(scope, name, args, { client });
    expect(result).toMatchObject({ error: { code: "invalid-request" } });
    expect(JSON.stringify(result)).not.toContain("secret-input");
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    "https://127.0.0.1:43210/computer-use",
    "http://localhost:43210/computer-use",
    "http://127.0.0.2:43210/computer-use",
    "http://user:pass@127.0.0.1:43210/computer-use",
    `${url}?token=x`,
    `${url}#x`,
    `${url}/`,
    "http://2130706433:43210/computer-use",
    "http://127.0.0.1:43210/a/../computer-use",
  ])("rejects noncanonical broker endpoint %s", (badUrl) => {
    expect(() => createDesktopComputerClient({ url: badUrl, token })).toThrow();
  });

  it("authenticates using trusted credentials and caller scope", async () => {
    const { client, fetch } = fixture(unavailable);
    expect(await executeComputerTool(scope, "djl_computer_status", {}, { client })).toEqual(
      unavailable,
    );
    const [endpoint, init] = fetch.mock.calls[0]!;
    expect(endpoint).toBe(url);
    expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${token}`);
    expect(init?.redirect).toBe("error");
    expect(JSON.parse(init?.body as string)).toEqual({
      threadId: scope.threadId,
      request: { method: "status" },
    });
  });

  it("rejects wrong methods and malformed success/error payloads", async () => {
    for (const response of [
      { method: "apps.list", result: [] },
      { ...unavailable, extra: true },
      { ...unavailable, error: { code: "internal", message: "x" } },
    ]) {
      const { client } = fixture(response);
      expect(await executeComputerTool(scope, "djl_computer_status", {}, { client })).toMatchObject(
        { error: { code: "internal" } },
      );
    }
  });

  it("rejects mismatched session ownership and target on open", async () => {
    for (const result of [
      { ...session, threadId: "thread-b" },
      { ...session, target: { ...target, windowId: 8 } },
    ]) {
      const { client } = fixture({ method: "session.open", result });
      expect(
        await executeComputerTool(scope, "djl_computer_open", { target }, { client }),
      ).toMatchObject({ error: { code: "internal" } });
    }
  });

  it("checks observations against the opened identity and caller thread", async () => {
    const { client, fetch } = fixture(
      { method: "session.open", result: session },
      { method: "session.observe", result: { ...observation, target: { ...target, pid: 43 } } },
      { method: "session.observe", result: { ...observation, sessionId: "other" } },
      { method: "session.observe", result: observation },
    );
    await executeComputerTool(scope, "djl_computer_open", { target }, { client });
    expect(
      await executeComputerTool(
        { threadId: "thread-b" },
        "djl_computer_observe",
        { sessionId: session.sessionId },
        { client },
      ),
    ).toMatchObject({ error: { code: "unauthorized-session" } });
    for (let n = 0; n < 2; n++)
      expect(
        await executeComputerTool(
          scope,
          "djl_computer_observe",
          { sessionId: session.sessionId },
          { client },
        ),
      ).toMatchObject({ error: { code: "internal" } });
    expect(
      await executeComputerTool(
        scope,
        "djl_computer_observe",
        { sessionId: session.sessionId },
        { client },
      ),
    ).toEqual({ method: "session.observe", result: observation });
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it("preserves cancelled and dispatched/unverified action outcomes", async () => {
    const { client } = fixture(
      { method: "session.open", result: session },
      { method: "session.perform", result: { acknowledgement: "cancelled", effect: "unverified" } },
      {
        method: "session.perform",
        result: { acknowledgement: "dispatched", effect: "unverified" },
      },
    );
    await executeComputerTool(scope, "djl_computer_open", { target }, { client });
    const args = {
      sessionId: session.sessionId,
      action: { type: "click", target: { kind: "point", x: 1, y: 2 } },
    };
    expect(await executeComputerTool(scope, "djl_computer_action", args, { client })).toMatchObject(
      { result: { acknowledgement: "cancelled", effect: "unverified" } },
    );
    expect(await executeComputerTool(scope, "djl_computer_action", args, { client })).toMatchObject(
      { result: { acknowledgement: "dispatched", effect: "unverified" } },
    );
  });

  it("requests agent history only and rejects leaked passive history", async () => {
    const { client, fetch } = fixture({
      method: "history.list",
      result: {
        events: [{ id: "e", at: "now", source: "passive", type: "passive-observation", target }],
      },
    });
    expect(await executeComputerTool(scope, "djl_computer_history", {}, { client })).toMatchObject({
      error: { code: "internal" },
    });
    expect(JSON.parse(fetch.mock.calls[0]![1]?.body as string).request).toEqual({
      method: "history.list",
      source: "agent",
    });
  });

  it("queries recorded activity with bounded dates and without any model-provided grant", async () => {
    const page = {
      snapshots: [
        {
          id: "record-1",
          capturedAt: "2026-10-28T12:00:00.000Z",
          target,
          appName: "Fixture",
          windowTitle: "Controlled fixture",
          labels: ["A static label"],
        },
      ],
      summaries: [],
      nextCursor: "record-1",
    };
    const { client, fetch } = fixture({ method: "activity.list", result: page });
    const args = {
      cursor: "record-0",
      limit: 10,
      since: "2026-10-28T00:00:00.000Z",
      until: "2026-10-29T00:00:00.000Z",
      bundleId: "org.djl.fixture",
      semanticCursor: "previous-summary",
    };
    expect(await executeComputerTool(scope, "djl_computer_activity", args, { client })).toEqual({
      method: "activity.list",
      result: page,
    });
    expect(JSON.parse(fetch.mock.calls[0]![1]?.body as string)).toEqual({
      threadId: scope.threadId,
      request: { method: "activity.list", ...args },
    });
    expect(COMPUTER_TOOLS.find((tool) => tool.name === "djl_computer_activity")?._meta).toEqual({
      "djl/tool-classification": "read",
    });
  });

  it("requires the manager's trusted-turn grant and keeps activity denial actionable", async () => {
    const { client } = fixture({
      method: "activity.list",
      error: { code: "permission-denied", message: token },
    });
    const response = await executeComputerTool(scope, "djl_computer_activity", {}, { client });
    expect(response).toMatchObject({
      error: {
        code: "permission-denied",
        message: expect.stringContaining("Select the computer-history skill"),
      },
    });
    const mcp = computerToolMcpResult(response);
    expect(mcp).toMatchObject({ isError: true });
    expect(JSON.stringify(mcp)).toContain("Select the computer-history skill");
    expect(JSON.stringify(mcp)).not.toContain(token);
    expect(JSON.stringify(mcp)).not.toContain("System Settings");
  });

  it("blocks activity locally until the trusted turn-start grant succeeds", async () => {
    vi.mocked(isComputerActivityHistoryAuthorized).mockReturnValue(false);
    const { client, fetch } = fixture({
      method: "activity.list",
      result: { snapshots: [], summaries: [] },
    });
    expect(await executeComputerTool(scope, "djl_computer_activity", {}, { client })).toMatchObject(
      { error: { code: "permission-denied" } },
    );
    expect(fetch).not.toHaveBeenCalled();
    expect(isComputerActivityHistoryAuthorized).toHaveBeenCalledWith(scope.threadId);
  });

  it("rejects malformed recorded activity and exposes no model recording controls", async () => {
    const { client, fetch } = fixture({
      method: "activity.list",
      result: { snapshots: [], summaries: [], allowActivityHistory: true },
    });
    expect(await executeComputerTool(scope, "djl_computer_activity", {}, { client })).toMatchObject(
      { error: { code: "internal" } },
    );
    for (const name of [
      "djl_computer_activity_clear",
      "djl_computer_activity_capture",
      "djl_computer_activity_configure",
    ]) {
      expect(await executeComputerTool(scope, name, {}, { client })).toMatchObject({
        error: { code: "invalid-request" },
      });
    }
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("rejects stop results for other chats and revokes locally stopped sessions", async () => {
    const { client, fetch } = fixture(
      { method: "session.open", result: session },
      { method: "stop", result: { stoppedSessionIds: ["another-chat-session"] } },
      { method: "stop", result: { stoppedSessionIds: [session.sessionId] } },
    );
    await executeComputerTool(scope, "djl_computer_open", { target }, { client });
    expect(await executeComputerTool(scope, "djl_computer_stop", {}, { client })).toMatchObject({
      error: { code: "internal" },
    });
    expect(await executeComputerTool(scope, "djl_computer_stop", {}, { client })).toEqual({
      method: "stop",
      result: { stoppedSessionIds: [session.sessionId] },
    });
    expect(
      await executeComputerTool(
        scope,
        "djl_computer_observe",
        { sessionId: session.sessionId },
        { client },
      ),
    ).toMatchObject({ error: { code: "unauthorized-session" } });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(JSON.parse(fetch.mock.calls[2]![1]?.body as string)).toEqual({
      threadId: scope.threadId,
      request: { method: "stop" },
    });
  });

  it("validates observed action effects against the session target", async () => {
    const { client } = fixture(
      { method: "session.open", result: session },
      {
        method: "session.perform",
        result: {
          acknowledgement: "dispatched",
          effect: "observed-change",
          observation: { ...observation, target: { ...target, windowId: 9 } },
        },
      },
      {
        method: "session.perform",
        result: { acknowledgement: "dispatched", effect: "observed-change", observation },
      },
    );
    await executeComputerTool(scope, "djl_computer_open", { target }, { client });
    const args = {
      sessionId: session.sessionId,
      action: {
        type: "click",
        target: { kind: "element", snapshotId: observation.snapshotId, elementId: 0 },
      },
    };
    expect(await executeComputerTool(scope, "djl_computer_action", args, { client })).toMatchObject(
      { error: { code: "internal" } },
    );
    expect(await executeComputerTool(scope, "djl_computer_action", args, { client })).toEqual({
      method: "session.perform",
      result: { acknowledgement: "dispatched", effect: "observed-change", observation },
    });
  });

  it("keeps broker and network secrets out of errors", async () => {
    const { client, fetch } = fixture({
      method: "status",
      error: { code: "permission-denied", message: token },
    });
    expect(await executeComputerTool(scope, "djl_computer_status", {}, { client })).toMatchObject({
      error: { code: "permission-denied", message: expect.stringContaining("System Settings") },
    });
    fetch.mockRejectedValueOnce(new Error(`${url} authorization ${token}`));
    const result = await executeComputerTool(scope, "djl_computer_status", {}, { client });
    expect(result).toMatchObject({ error: { code: "helper-unavailable" } });
    expect(JSON.stringify(result)).not.toContain(token);
    expect(JSON.stringify(result)).not.toContain(url);
  });

  it("bounds response bytes even without content-length", async () => {
    const { client, fetch } = fixture();
    fetch.mockResolvedValueOnce(new Response(" ".repeat(8 * 1024 * 1024 + 1)));
    expect(await executeComputerTool(scope, "djl_computer_status", {}, { client })).toMatchObject({
      error: { code: "internal" },
    });
  });

  it("aborts timed out and cancelled broker requests", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new Error("private network detail")),
            { once: true },
          );
        }),
    );
    const client = createDesktopComputerClient({ url, token, fetch, timeoutMs: 5 });
    expect(await executeComputerTool(scope, "djl_computer_status", {}, { client })).toMatchObject({
      error: { code: "timeout" },
    });
    const controller = new AbortController();
    const request = executeComputerTool(
      scope,
      "djl_computer_status",
      {},
      { client, signal: controller.signal },
    );
    controller.abort();
    expect(await request).toMatchObject({ error: { code: "cancelled" } });
  });
});
