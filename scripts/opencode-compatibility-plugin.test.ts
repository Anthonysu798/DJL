import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";
import { createOpenCodeCompatibilityPluginSource } from "@synara/shared/openCodeCompatibility";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture(
  content: string,
  policy: Record<string, unknown> = {},
  native = false,
  failFirst = false,
  providerID = "ollama",
) {
  const root = await mkdtemp(join(tmpdir(), "djl-compatibility-unit-"));
  roots.push(root);
  const policyPath = join(root, "policy.json");
  await writeFile(policyPath, JSON.stringify({ session: policy }));
  const source = ts.transpileModule(createOpenCodeCompatibilityPluginSource(policyPath), {
    compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext },
  }).outputText;
  const plugin = await import(
    /* @vite-ignore */ `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
  );
  const hooks = await plugin.default();
  const requests: Array<Record<string, unknown>> = [];
  const sentHeaders: Headers[] = [];
  const config = {
    provider: {
      [providerID]: {
        options: {
          fetch: async (_url: unknown, init: RequestInit) => {
            requests.push(JSON.parse(String(init.body)));
            sentHeaders.push(new Headers(init.headers));
            const delta = native
              ? {
                  tool_calls: [
                    {
                      index: 0,
                      id: "native",
                      type: "function",
                      function: { name: content, arguments: '{"filePath":"fixture.txt"}' },
                    },
                  ],
                }
              : { content };
            const stream =
              [
                { choices: [{ index: 0, delta, finish_reason: null }] },
                {
                  choices: [{ index: 0, delta: {}, finish_reason: native ? "tool_calls" : "stop" }],
                },
              ]
                .map((chunk) => `data: ${JSON.stringify(chunk)}\r\n\r\n`)
                .join("") + "data: [DONE]\r\n\r\n";
            // Deliberately split CRLF and UTF-8 sequences over arbitrary network chunks.
            const bytes = new TextEncoder().encode(stream);
            return new Response(
              new ReadableStream({
                start(controller) {
                  for (let i = 0; i < bytes.length; i += 3)
                    controller.enqueue(bytes.slice(i, i + 3));
                  controller.close();
                },
              }),
              {
                status: failFirst && requests.length === 1 ? 503 : 200,
                headers: { "content-type": "text/event-stream" },
              },
            );
          },
        },
      },
    },
  };
  await hooks.config(config);
  const run = async (tools = ["read"], turn = "turn", toolcall = true, sessionID = "session") => {
    const output = { headers: {} };
    await hooks["chat.headers"](
      {
        sessionID,
        model: { providerID, capabilities: { toolcall } },
        message: { id: turn },
      },
      output,
    );
    const response = await config.provider[providerID]!.options.fetch("http://fixture", {
      headers: output.headers,
      body: JSON.stringify({
        stream: true,
        messages: [
          { role: "system", content: "INHERITED" },
          { role: "user", content: "Read" },
        ],
        tools: tools.map((name) => ({ type: "function", function: { name } })),
        tool_choice: "auto",
      }),
    });
    return response.text();
  };
  return { hooks, run, requests, sentHeaders, policyPath };
}

describe("official OpenCode compatibility plugin", () => {
  it.each([
    '{"name":"read","arguments":{"filePath":"fixture.txt"}}',
    '<tool_call>{"function_name":"READ","arguments":"{\\"filePath\\":\\"fixture.txt\\"}"}</tool_call>',
    '<｜DSML｜tool_calls><｜DSML｜invoke name="read"><｜DSML｜parameter name="filePath" string="true">fixture.txt</｜DSML｜parameter></｜DSML｜invoke></｜DSML｜tool_calls>',
  ])("converts supported text calls into native SSE calls: %s", async (content) => {
    const f = await fixture(content);
    const result = await f.run();
    expect(result).toContain('"tool_calls"');
    expect(result).toContain('"name":"read"');
    expect(result).toContain('"finish_reason":"tool_calls"');
  });
  it("isolates Work instructions and requires tools only on the first request per turn", async () => {
    const f = await fixture("Readable answer.", {
      instructionScope: "work-isolated",
      system: ["CONTROLLED"],
      requiredToolCall: true,
    });
    await f.run();
    await f.run();
    await f.run(["read"], "next");
    expect(f.requests.map((request) => request.tool_choice)).toEqual([
      "required",
      "auto",
      "required",
    ]);
    expect(JSON.stringify(f.requests)).not.toContain("INHERITED");
    expect(JSON.stringify(f.requests)).toContain("CONTROLLED");
    expect(f.sentHeaders.every((headers) => !headers.has("x-djl-compatibility-context"))).toBe(
      true,
    );
    const output = { system: ["INHERITED"] };
    await f.hooks["experimental.chat.system.transform"]({ sessionID: "session" }, output);
    expect(output.system).toEqual(["CONTROLLED"]);
  });
  it("preserves native instructions and readable text", async () => {
    const f = await fixture("Readable answer.");
    const result = await f.run();
    expect(JSON.stringify(f.requests)).toContain("INHERITED");
    expect(f.requests[0]?.tool_choice).toBe("auto");
    expect(result).toContain("Readable answer.");
    expect(result).not.toContain("djl-local-");
  });
  it("limits recovery to offered tools", async () => {
    const f = await fixture('{"name":"bash","arguments":{"command":"pwd"}}');
    expect(await f.run()).not.toContain("djl-local-");
  });
  it.each([false, true])("round trips unique managed MCP aliases (native=%s)", async (native) => {
    const f = await fixture(
      native ? "system_info" : '{"name":"system_info","arguments":{}}',
      { visibleTools: ["system_info"] },
      native,
    );
    const result = await f.run(["djl_system_info", "bash"]);
    expect(f.requests[0]?.tools).toEqual([{ type: "function", function: { name: "system_info" } }]);
    expect(result).toContain('"name":"djl_system_info"');
  });
  it("does not select an ambiguous managed alias", async () => {
    const f = await fixture("Readable answer.", { visibleTools: ["system_info"] });
    await f.run(["one_system_info", "two_system_info"]);
    expect(f.requests[0]?.tools).toEqual([]);
  });
  it("mutates the upstream system array for cloud Work and preserves cloud native headers", async () => {
    const f = await fixture("Answer", {
      instructionScope: "work-isolated",
      system: ["CONTROLLED"],
    });
    const system = ["INHERITED"];
    await f.hooks["experimental.chat.system.transform"](
      { sessionID: "session", model: { providerID: "openai" } },
      { system },
    );
    expect(system).toEqual(["CONTROLLED"]);
    const output = { headers: {} };
    await f.hooks["chat.headers"](
      { sessionID: "session", model: { providerID: "openai" }, message: { id: "turn" } },
      output,
    );
    expect(output.headers).toEqual({});
  });
  it("does not send tool definitions to chat-only models", async () => {
    const f = await fixture("Answer", { requiredToolCall: true });
    await f.run(["read"], "turn", false);
    expect(f.requests[0]).not.toHaveProperty("tools");
    expect(f.requests[0]).not.toHaveProperty("tool_choice");
  });
  it("adds web-search retrieval evidence without modifying other outputs", async () => {
    const f = await fixture("Answer");
    const result = { output: "Source result" };
    await f.hooks["tool.execute.after"]({ tool: "websearch" }, result);
    expect(result.output).toMatch(/Source result\n\nRetrieved at: \d{4}-/);
    const read = { output: "File data" };
    await f.hooks["tool.execute.after"]({ tool: "read" }, read);
    expect(read.output).toBe("File data");
  });
  it("rejects replaced provider transports before adding internal headers", async () => {
    const f = await fixture("Answer");
    const output = { headers: {} };
    await expect(
      f.hooks["chat.headers"](
        {
          sessionID: "session",
          model: { providerID: "ollama" },
          provider: { options: { fetch: async () => new Response() } },
          message: { id: "turn" },
        },
        output,
      ),
    ).rejects.toThrow("overridden");
    expect(output.headers).toEqual({});
  });
  it("runs native sessions before a policy file has been created", async () => {
    const f = await fixture("Answer");
    await rm(f.policyPath);
    const system = ["NATIVE"];
    await f.hooks["experimental.chat.system.transform"]({ sessionID: "session" }, { system });
    expect(system).toEqual(["NATIVE"]);
    expect(await f.run()).toContain("Answer");
  });
  it("keeps concurrent session policies and per-turn tool choice independent", async () => {
    const f = await fixture("Answer");
    await writeFile(
      f.policyPath,
      JSON.stringify({
        a: { instructionScope: "work-isolated", system: ["ONLY_A"], requiredToolCall: true },
        b: { instructionScope: "work-isolated", system: ["ONLY_B"], requiredToolCall: false },
      }),
    );
    await Promise.all([f.run(["read"], "turn-a", true, "a"), f.run(["read"], "turn-b", true, "b")]);
    const a = f.requests.find((request) => JSON.stringify(request.messages).includes("ONLY_A"));
    const b = f.requests.find((request) => JSON.stringify(request.messages).includes("ONLY_B"));
    expect(a?.tool_choice).toBe("required");
    expect(b?.tool_choice).toBe("auto");
    expect(JSON.stringify(a)).not.toContain("ONLY_B");
    expect(JSON.stringify(b)).not.toContain("ONLY_A");
    await f.run(["read"], "turn-a", true, "a");
    expect(f.requests.at(-1)?.tool_choice).toBe("auto");
    await f.run(["read"], "turn-a-next", true, "a");
    expect(f.requests.at(-1)?.tool_choice).toBe("required");
  });
  it("retains exact registered tool names without aliasing", async () => {
    const f = await fixture('{"name":"djl_system_info","arguments":{}}', {
      visibleTools: ["djl_system_info"],
    });
    const result = await f.run(["djl_system_info", "bash"]);
    expect(f.requests[0]?.tools).toEqual([
      { type: "function", function: { name: "djl_system_info" } },
    ]);
    expect(result).toContain('"name":"djl_system_info"');
  });
  it("retains required tool choice when the first model request needs retry", async () => {
    const f = await fixture("Answer", { requiredToolCall: true }, false, true);
    await f.run();
    await f.run();
    await f.run();
    expect(f.requests.map((request) => request.tool_choice)).toEqual([
      "required",
      "required",
      "auto",
    ]);
  });
  it("prefers exact registered names over colliding suffix aliases", async () => {
    const f = await fixture("Answer", { visibleTools: ["read"] });
    await f.run(["read", "mcp_read"]);
    expect(f.requests[0]?.tools).toEqual([{ type: "function", function: { name: "read" } }]);
  });
});

it("recovers DeepSeek text calls without forcing unsupported remote tool choice", async () => {
  const f = await fixture(
    '{"name":"read","arguments":{"filePath":"fixture.txt"}}',
    { requiredToolCall: true },
    false,
    false,
    "deepseek",
  );
  expect(await f.run()).toContain('"tool_calls"');
  expect(f.requests[0]?.tool_choice).toBe("auto");
});
