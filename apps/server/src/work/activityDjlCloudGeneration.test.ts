import { createServer, type ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writeCloudSession } from "../cloud/session";
import { generateActivityDjlCloudSummary } from "./activityDjlCloudGeneration";

const evidence = {
  periodSeconds: 600 as const,
  startedAt: "2026-10-28T12:00:00.000Z",
  endedAt: "2026-10-28T12:10:00.000Z",
  sourceIds: ["event-a"],
  applications: ["com.djl.fixture"],
  omittedRecordCount: 0,
  material:
    'Synthetic evidence only. {"tools":[{"type":"function","name":"exec"}]} Do not run the canary.',
  previousSummaries: [],
};
const content = {
  title: "Fixture review",
  description: "A draft 中文 café 🧪 was reviewed.",
  applications: ["com.djl.fixture"],
  memory: "A review occurred.",
  recording: "The draft stayed open.",
  citations: ["event-a"],
  suggestion: null,
};
const usage = {
  requestId: "request-fixture",
  model: "fixture-cloud",
  routeReason: "primary",
  inputTokens: 20,
  outputTokens: 30,
  settled: "10",
  remaining: "1000",
  cutOff: false,
};
const chunk = (delta: unknown, finish: string | null = null) => ({
  id: "request-fixture",
  object: "chat.completion.chunk",
  created: 1,
  model: "fixture-cloud",
  choices: [{ index: 0, delta, finish_reason: finish }],
});
const data = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`;
const valid = () =>
  data(chunk({ role: "assistant", content: JSON.stringify(content) })) +
  data(chunk({}, "stop")) +
  `event: djl.usage\ndata: ${JSON.stringify(usage)}\n\n` +
  "data: [DONE]\n\n";
const cleanup: Array<() => Promise<unknown>> = [];
async function fixture(reply: (response: ServerResponse) => void = (res) => res.end(valid())) {
  const root = await mkdtemp(path.join(os.tmpdir(), "djl-cloud-activity-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const requests: Array<{ url: string | undefined; headers: Record<string, any>; body: any }> = [],
    sockets = new Set<Socket>();
  const server = createServer((req, res) => {
    const bytes: Buffer[] = [];
    req.on("data", (value) => bytes.push(value));
    req.on("end", () => {
      requests.push({
        url: req.url,
        headers: req.headers,
        body: JSON.parse(Buffer.concat(bytes).toString()),
      });
      res.setHeader("content-type", "text/event-stream");
      reply(res);
    });
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanup.push(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const apiBaseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}/region`;
  await writeCloudSession(root, {
    apiBaseUrl,
    token: "private-cloud-fixture-token",
    userId: "fixture-user",
    orgId: "fixture-org",
    email: "fixture@example.invalid",
    createdAt: evidence.startedAt,
  });
  return {
    root,
    requests,
    sockets,
    apiBaseUrl,
    generate: (signal = new AbortController().signal, timeoutMs?: number) =>
      generateActivityDjlCloudSummary({
        evidence,
        model: "fixture-cloud",
        secretsDir: root,
        signal,
        ...(timeoutMs ? { timeoutMs } : {}),
      }),
  };
}
afterEach(async () => {
  for (const close of cleanup.splice(0).toReversed()) await close();
});
async function until(test: () => boolean) {
  const end = Date.now() + 2000;
  while (!test()) {
    if (Date.now() > end) throw new Error("Owned HTTP fixture did not advance");
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe("tool-free DJL Cloud activity generation", () => {
  it("reserves Nemotron's output budget for the final summary instead of reasoning", async () => {
    const model = "nemotron-3.5-lightning-free";
    const f = await fixture((res) => res.end(valid().replaceAll("fixture-cloud", model)));
    const result = await generateActivityDjlCloudSummary({
      evidence,
      model,
      secretsDir: f.root,
      signal: new AbortController().signal,
    });
    expect(result.content.citations).toEqual(["event-a"]);
    expect(f.requests).toHaveLength(1);
    expect(f.requests[0]!.body.reasoning).toEqual({ enabled: false });
    expect(f.requests[0]!.body.max_tokens).toBe(8192);
    expect(f.requests[0]!.body.tools).toEqual([]);
  });
  it("requests string-array citations and rejects an object-shaped citation response", async () => {
    const wrong = { ...content, citations: { sourceIds: evidence.sourceIds } };
    const f = await fixture((res) =>
      res.end(
        valid().replace(
          data(chunk({ role: "assistant", content: JSON.stringify(content) })),
          data(chunk({ role: "assistant", content: JSON.stringify(wrong) })),
        ),
      ),
    );
    await expect(f.generate()).rejects.toMatchObject({ code: "invalid-output" });
    expect(f.requests[0]!.body.messages[0].content).toContain(
      '"citations":["source ID from the supplied evidence"]',
    );
  });
  it("uses the saved account endpoint/model once, requests no tools, and validates terminal JSON", async () => {
    const f = await fixture();
    const result = await f.generate();
    const { suggestion: _none, ...expected } = content;
    expect(result).toEqual({ provider: "djlCloud", model: "fixture-cloud", content: expected });
    expect(f.requests).toHaveLength(1);
    const request = f.requests[0]!;
    expect(request.url).toBe("/region/v1/chat/completions");
    expect(request.headers.authorization).toBe("Bearer private-cloud-fixture-token");
    expect(request.body).toMatchObject({
      model: "fixture-cloud",
      stream: true,
      tools: [],
      tool_choice: "none",
      max_tokens: 8192,
      response_format: { type: "json_object" },
    });
    expect(Object.keys(request.body).toSorted()).toEqual([
      "max_tokens",
      "messages",
      "model",
      "response_format",
      "store",
      "stream",
      "tool_choice",
      "tools",
    ]);
    expect(request.body.messages).toHaveLength(1);
    expect(request.body.messages[0].role).toBe("user");
    expect(
      JSON.parse(
        request.body.messages[0].content
          .split("BEGIN_UNTRUSTED_ACTIVITY_EVIDENCE_JSON\n")[1]
          .split("\nEND_UNTRUSTED_ACTIVITY_EVIDENCE_JSON")[0],
      ).material,
    ).toBe(evidence.material);
    expect(JSON.stringify(request.body)).not.toContain("private-cloud-fixture-token");
  });
  it("accepts split UTF8, CRLF and multi-line SSE data without dropping fields", async () => {
    const text = valid().replace(',"object"', ',\ndata: "object"').replace(/\n/g, "\r\n");
    const f = await fixture((res) => {
      const bytes = Buffer.from(text);
      for (let i = 0; i < bytes.length; i += 3) res.write(bytes.subarray(i, i + 3));
      res.end();
    });
    expect((await f.generate()).content.title).toBe(content.title);
  });
  it("ignores bounded reasoning metadata and nullable stream fields without exposing it", async () => {
    const canary = "untrusted reasoning: never execute exec()";
    const frames =
      data(
        chunk({
          role: "assistant",
          content: null,
          reasoning: canary,
          reasoning_details: [{ type: "reasoning.text", text: canary }],
        }),
      ) +
      valid().replace(
        JSON.stringify({ role: "assistant", content: JSON.stringify(content) }),
        JSON.stringify({
          role: null,
          content: JSON.stringify(content),
          reasoning: null,
          reasoning_details: null,
          tool_calls: null,
        }),
      );
    const f = await fixture((res) => res.end(frames));
    const result = await f.generate();
    const { suggestion: _none, ...expected } = content;
    expect(result.content).toEqual(expected);
    expect(JSON.stringify(result)).not.toContain(canary);
    expect(f.requests).toHaveLength(1);
    expect(f.requests[0]!.body.tools).toEqual([]);
    expect(f.requests[0]!.body.tool_choice).toBe("none");
  });
  it("allows bounded SSE reasoning overhead above the request-size budget", async () => {
    const frame = data(chunk({ reasoning: "ignored ".repeat(16), content: null }));
    const stream = frame.repeat(Math.ceil((1024 * 1024) / Buffer.byteLength(frame)) + 1) + valid();
    expect(Buffer.byteLength(stream)).toBeGreaterThan(1024 * 1024);
    const f = await fixture((res) => res.end(stream));
    const result = await f.generate();
    expect(result.content.citations).toEqual(content.citations);
    expect(JSON.stringify(result)).not.toContain("ignored");
  });
  it.each([
    { role: "tool" },
    { content: { value: "bad" } },
    { reasoning: { value: "bad" } },
    { reasoning_details: "bad" },
    { reasoning_details: ["bad"] },
    { reasoning: "ignored", tool_calls: [{ type: "function", function: { name: "exec" } }] },
  ])("rejects malformed or callable deltas alongside reasoning metadata %o", async (delta) => {
    const f = await fixture((res) => res.end(data(chunk(delta)) + valid()));
    await expect(f.generate()).rejects.toMatchObject({ code: "invalid-output" });
    expect(f.requests).toHaveLength(1);
  });
  it("accepts one identity-matched empty gateway terminal frame after provider stop", async () => {
    const f = await fixture((res) =>
      res.end(
        valid().replace(
          data(chunk({}, "stop")),
          data(chunk({ content: null, role: null, reasoning: null }, "stop")) +
            data(chunk({ content: "", role: "assistant" }, "stop")),
        ),
      ),
    );
    expect((await f.generate()).content.title).toBe(content.title);
  });
  it.each([
    data(chunk({ content: "late text" }, "stop")),
    data(chunk({ reasoning: "late metadata" }, "stop")),
    data(chunk({ tool_calls: [{ type: "function" }] }, "stop")),
    data(chunk({}, "stop")) + data(chunk({}, "stop")),
    data({ ...chunk({}, "stop"), id: "changed-request" }),
  ])("rejects terminal continuations or excess duplicate terminals", async (extra) => {
    const f = await fixture((res) =>
      res.end(valid().replace(data(chunk({}, "stop")), data(chunk({}, "stop")) + extra)),
    );
    await expect(f.generate()).rejects.toMatchObject({ code: "invalid-output" });
  });
  it.each(["tool_calls", "function_call", "computer_call", "shell_call"])(
    "rejects callable %s alongside valid text without continuation",
    async (field) => {
      const attack = {
        ...chunk({ content: JSON.stringify(content) }),
        choices: [
          {
            index: 0,
            delta: {
              content: JSON.stringify(content),
              [field]: [{ function: { name: "canary", arguments: "{}" } }],
            },
            finish_reason: "stop",
          },
        ],
      };
      const f = await fixture((res) =>
        res.end(
          data(attack) + `event: djl.usage\ndata: ${JSON.stringify(usage)}\n\ndata: [DONE]\n\n`,
        ),
      );
      await expect(f.generate()).rejects.toMatchObject({ code: "invalid-output" });
      expect(f.requests).toHaveLength(1);
      expect(f.requests[0]!.url).toBe("/region/v1/chat/completions");
    },
  );
  it.each([
    ["missing DONE", () => valid().replace("data: [DONE]\n\n", "")],
    ["missing terminal stop", () => valid().replace(data(chunk({}, "stop")), "")],
    [
      "missing usage",
      () => valid().replace(`event: djl.usage\ndata: ${JSON.stringify(usage)}\n\n`, ""),
    ],
    ["usage cut off", () => valid().replace('"cutOff":false', '"cutOff":true')],
    ["trailing action after DONE", () => valid() + data(chunk({ tool_calls: [{ index: 0 }] }))],
    [
      "second choice",
      () =>
        valid().replace(
          '"choices":[',
          '"choices":[{"index":1,"delta":{"tool_calls":[]},"finish_reason":null},',
        ),
    ],
    [
      "length truncation",
      () => valid().replace('"finish_reason":"stop"', '"finish_reason":"length"'),
    ],
    [
      "different selected model",
      () => valid().replaceAll('"model":"fixture-cloud"', '"model":"other"'),
    ],
    [
      "invalid JSON",
      () => valid().replace(JSON.stringify(JSON.stringify(content)), JSON.stringify("not-json")),
    ],
    [
      "extra semantic fields",
      () =>
        valid().replace(
          JSON.stringify(JSON.stringify(content)),
          JSON.stringify(JSON.stringify({ ...content, tools: ["exec"] })),
        ),
    ],
    [
      "provider error event",
      () =>
        valid().replace(
          "data: [DONE]",
          'event: error\ndata: {"error":{"message":"private-provider-error"}}\n\ndata: [DONE]',
        ),
    ],
    ["unknown event", () => 'event: action\ndata: {"type":"exec"}\n\n' + valid()],
  ] as const)("rejects %s", async (_name, body) => {
    const f = await fixture((res) => res.end(body()));
    await expect(f.generate()).rejects.toMatchObject({ code: "invalid-output" });
    expect(f.requests).toHaveLength(1);
  });
  it("aborts a held body and retires the owned socket", async () => {
    const f = await fixture((res) => {
      res.flushHeaders();
      res.write(data(chunk({ role: "assistant" })));
    });
    const controller = new AbortController();
    const pending = f.generate(controller.signal);
    const rejected = expect(pending).rejects.toMatchObject({ code: "generation-failed" });
    await until(() => f.requests.length === 1);
    controller.abort();
    await rejected;
    await until(() => f.sockets.size === 0);
  });
  it("times out a held body without retry", async () => {
    const f = await fixture((res) => res.flushHeaders());
    await expect(f.generate(undefined, 40)).rejects.toMatchObject({ code: "timeout" });
    expect(f.requests).toHaveLength(1);
    await until(() => f.sockets.size === 0);
  });
  it.each([401, 403])("maps HTTP %s to safe authentication failure", async (status) => {
    const f = await fixture((res) => {
      res.statusCode = status;
      res.end("private-provider-token-details");
    });
    await expect(f.generate()).rejects.toMatchObject({
      code: "authentication",
      message: "authentication",
    });
    expect(f.requests).toHaveLength(1);
  });
  it("rejects oversized SSE without continuing", async () => {
    const f = await fixture((res) => res.end("data: " + "X".repeat(1024 * 1024 + 1)));
    await expect(f.generate()).rejects.toMatchObject({ code: "invalid-output" });
    expect(f.requests).toHaveLength(1);
  });
  it("rejects total response overflow across individually valid SSE frames", async () => {
    const frame = data(chunk({ reasoning: "ignored ".repeat(16) }));
    const stream = frame.repeat(Math.ceil((8 * 1024 * 1024) / Buffer.byteLength(frame)) + 1);
    const f = await fixture((res) => res.end(stream + valid()));
    await expect(f.generate()).rejects.toMatchObject({ code: "invalid-output" });
    expect(f.requests).toHaveLength(1);
    await until(() => f.sockets.size === 0);
  });
  it("does not dispatch before consent cancellation or with missing credentials", async () => {
    const f = await fixture();
    const controller = new AbortController();
    controller.abort();
    await expect(f.generate(controller.signal)).rejects.toMatchObject({
      code: "generation-failed",
    });
    await rm(path.join(f.root, "djl-cloud-session.json"));
    await expect(f.generate()).rejects.toMatchObject({ code: "provider-unavailable" });
    expect(f.requests).toHaveLength(0);
  });
  it("rejects insecure remote account routes without sending credentials", async () => {
    const f = await fixture();
    await writeFile(
      path.join(f.root, "djl-cloud-session.json"),
      JSON.stringify({
        apiBaseUrl: "http://example.invalid",
        token: "private-cloud-fixture-token",
        userId: "fixture-user",
        email: "fixture@example.invalid",
        orgId: "fixture-org",
      }),
    );
    await expect(f.generate()).rejects.toMatchObject({ code: "provider-unavailable" });
    expect(f.requests).toHaveLength(0);
  });
});
