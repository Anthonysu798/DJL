import type { LanguageModelV3StreamPart } from "@ai-sdk/provider";
import { describe, expect, test } from "bun:test";

import {
  createLocalToolCallMiddleware,
  parseLocalTextToolCalls,
  supportsTextToolCallRecovery,
} from "../../src/session/llm/local-tool-call-middleware";

describe("local text tool-call recovery", () => {
  test("enables text tool-call recovery for DeepSeek", () => {
    expect(supportsTextToolCallRecovery("deepseek")).toBe(true);
    expect(supportsTextToolCallRecovery("openai")).toBe(false);
  });

  test("recovers a DeepSeek DSML tool call emitted as assistant text", async () => {
    const middleware = createLocalToolCallMiddleware(new Set(["webfetch", "invalid"]));
    const output = await transform(middleware, [
      { type: "text-start", id: "text-dsml" },
      {
        type: "text-delta",
        id: "text-dsml",
        delta:
          '<｜｜DSML｜｜tool_calls><｜｜DSML｜｜invoke name="webfetch"><｜｜DSML｜｜parameter name="format" string="true">text</｜｜DSML｜｜parameter><｜｜DSML｜｜parameter name="numResults" string="false">3</｜｜DSML｜｜parameter><｜｜DSML｜｜parameter name="url" string="true">https://www.google.com/finance</｜｜DSML｜｜parameter></｜｜DSML｜｜invoke></｜｜DSML｜｜tool_calls>',
      },
      { type: "text-end", id: "text-dsml" },
    ]);

    expect(output).toHaveLength(4);
    expect(output[0]).toMatchObject({ type: "tool-input-start", toolName: "webfetch" });
    expect(output[1]).toMatchObject({
      type: "tool-input-delta",
      delta: '{"format":"text","numResults":3,"url":"https://www.google.com/finance"}',
    });
    expect(output[3]).toMatchObject({ type: "tool-call", toolName: "webfetch" });
    expect(output.some((part) => part.type === "text-delta")).toBe(false);
  });

  test("recovers the recorded DeepSeek websearch payload with typed arguments", async () => {
    const middleware = createLocalToolCallMiddleware(new Set(["websearch", "invalid"]));
    const output = await transform(middleware, [
      { type: "text-start", id: "text-recorded-dsml" },
      {
        type: "text-delta",
        id: "text-recorded-dsml",
        delta: [
          "<｜｜DSML｜｜tool_calls>",
          '<｜｜DSML｜｜invoke name="websearch">',
          '<｜｜DSML｜｜parameter name="query" string="true">MiniMax 0100.HK 收盘 2026年8月1日 或 7月31日 股价</｜｜DSML｜｜parameter>',
          '<｜｜DSML｜｜parameter name="numResults" string="false">6</｜｜DSML｜｜parameter>',
          "</｜｜DSML｜｜invoke>",
          "</｜｜DSML｜｜tool_calls>",
        ].join("\n"),
      },
      { type: "text-end", id: "text-recorded-dsml" },
    ]);

    expect(output).toHaveLength(4);
    expect(output[0]).toMatchObject({ type: "tool-input-start", toolName: "websearch" });
    expect(output[1]).toMatchObject({
      type: "tool-input-delta",
      delta:
        '{"query":"MiniMax 0100.HK 收盘 2026年8月1日 或 7月31日 股价","numResults":6}',
    });
    expect(output[3]).toMatchObject({ type: "tool-call", toolName: "websearch" });
    expect(output.some((part) => part.type === "text-delta")).toBe(false);
  });

  test("recovers multiple DSML calls without leaking any assistant text", async () => {
    const middleware = createLocalToolCallMiddleware(new Set(["websearch", "read", "invalid"]));
    const output = await transform(middleware, [
      { type: "text-start", id: "text-multi-dsml" },
      {
        type: "text-delta",
        id: "text-multi-dsml",
        delta:
          '<｜｜DSML｜｜tool_calls><｜｜DSML｜｜invoke name="websearch"><｜｜DSML｜｜parameter name="query" string="true">DJL</｜｜DSML｜｜parameter></｜｜DSML｜｜invoke><｜｜DSML｜｜invoke name="read"><｜｜DSML｜｜parameter name="filePath" string="true">README.md</｜｜DSML｜｜parameter></｜｜DSML｜｜invoke></｜｜DSML｜｜tool_calls>',
      },
      { type: "text-end", id: "text-multi-dsml" },
    ]);

    expect(output.filter((part) => part.type === "tool-call")).toHaveLength(2);
    expect(output.filter((part) => part.type === "tool-call").map((part) => part.toolName)).toEqual([
      "websearch",
      "read",
    ]);
    expect(output.some((part) => part.type === "text-delta")).toBe(false);
  });

  test("parses and de-duplicates bare tool JSON emitted as assistant text", () => {
    const text = [
      '{"name":"write","arguments":{"filePath":"C:/tmp/a.txt","content":"hello"}}',
      '{"name":"write","arguments":{"filePath":"C:/tmp/a.txt","content":"hello"}}',
    ].join("");

    expect(parseLocalTextToolCalls(text, new Set(["write", "read"]))).toEqual([
      {
        name: "write",
        arguments: { filePath: "C:/tmp/a.txt", content: "hello" },
      },
    ]);
  });

  test("recovers a leading tool call with trailing prose and rejects unknown tools", () => {
    expect(
      parseLocalTextToolCalls(
        '{"name":"write","arguments":{"filePath":"C:/tmp/a.txt"}}\nThis is an example.',
        new Set(["write"]),
      ),
    ).toEqual([{ name: "write", arguments: { filePath: "C:/tmp/a.txt" } }]);
    expect(
      parseLocalTextToolCalls('{"name":"unknown","arguments":{}}', new Set(["write"])),
    ).toBeUndefined();
  });

  test("routes invented local-model tools through the OpenCode invalid tool", () => {
    expect(
      parseLocalTextToolCalls(
        '{"name":"check_if_file_exists","arguments":{"filePath":"C:/tmp/a.txt"}}',
        new Set(["write", "invalid"]),
      ),
    ).toEqual([
      {
        name: "invalid",
        arguments: {
          tool: "check_if_file_exists",
          error: 'Unknown tool "check_if_file_exists" requested by the local model.',
        },
      },
    ]);
  });

  test("accepts the function_name variant emitted by smaller Ollama models", () => {
    expect(
      parseLocalTextToolCalls(
        '{"function_name":"todowrite","arguments":{"todos":[]}}',
        new Set(["todowrite", "invalid"]),
      ),
    ).toEqual([{ name: "todowrite", arguments: { todos: [] } }]);
  });

  test("routes truncated tool JSON through the OpenCode invalid tool instead of chat text", async () => {
    const middleware = createLocalToolCallMiddleware(new Set(["todowrite", "invalid"]));
    const output = await transform(middleware, [
      { type: "text-start", id: "text-truncated" },
      {
        type: "text-delta",
        id: "text-truncated",
        delta: '{"name":"todowrite","arguments":{"todos":[{"content":"Verify","priorit',
      },
      { type: "text-end", id: "text-truncated" },
    ]);

    expect(output).toHaveLength(4);
    expect(output[0]).toMatchObject({ type: "tool-input-start", toolName: "invalid" });
    expect(output[3]).toMatchObject({ type: "tool-call", toolName: "invalid" });
    expect(output.some((part) => part.type === "text-delta")).toBe(false);
  });

  test("routes syntactically invalid tool JSON through the OpenCode invalid tool", async () => {
    const middleware = createLocalToolCallMiddleware(new Set(["write", "invalid"]));
    const output = await transform(middleware, [
      { type: "text-start", id: "text-invalid-json" },
      {
        type: "text-delta",
        id: "text-invalid-json",
        delta: '{"name":"write","arguments":{"content":"literal\nnewline","filePath":"x"}}',
      },
      { type: "text-end", id: "text-invalid-json" },
    ]);
    expect(output[0]).toMatchObject({ type: "tool-input-start", toolName: "invalid" });
    expect(output.some((part) => part.type === "text-delta")).toBe(false);
  });

  test("keeps natural language streaming and converts only leaked tool JSON", async () => {
    const middleware = createLocalToolCallMiddleware(new Set(["write"]));
    const natural = await transform(middleware, [
      { type: "text-start", id: "text-1" },
      { type: "text-delta", id: "text-1", delta: "Hello " },
      { type: "text-delta", id: "text-1", delta: "world" },
      { type: "text-end", id: "text-1" },
    ]);
    expect(natural).toEqual([
      { type: "text-start", id: "text-1" },
      { type: "text-delta", id: "text-1", delta: "Hello " },
      { type: "text-delta", id: "text-1", delta: "world" },
      { type: "text-end", id: "text-1" },
    ]);

    const recovered = await transform(middleware, [
      { type: "text-start", id: "text-2" },
      { type: "text-delta", id: "text-2", delta: '{"name":"wr' },
      {
        type: "text-delta",
        id: "text-2",
        delta: 'ite","arguments":{"filePath":"C:/tmp/a.txt","content":"hello"}}',
      },
      { type: "text-end", id: "text-2" },
    ]);
    expect(recovered).toHaveLength(4);
    expect(recovered[0]).toMatchObject({ type: "tool-input-start", toolName: "write" });
    expect(recovered[1]).toMatchObject({
      type: "tool-input-delta",
      delta: '{"filePath":"C:/tmp/a.txt","content":"hello"}',
    });
    expect(recovered[2]).toMatchObject({ type: "tool-input-end" });
    expect(recovered[3]).toMatchObject({
      type: "tool-call",
      toolName: "write",
      input: '{"filePath":"C:/tmp/a.txt","content":"hello"}',
    });
    const toolInputID = "id" in recovered[0] ? recovered[0].id : undefined;
    expect(toolInputID).toEqual(expect.any(String));
    expect("id" in recovered[1] && recovered[1].id).toBe(toolInputID);
    expect("id" in recovered[2] && recovered[2].id).toBe(toolInputID);
    expect("toolCallId" in recovered[3] && recovered[3].toolCallId).toBe(toolInputID);
  });
});

async function transform(
  middleware: ReturnType<typeof createLocalToolCallMiddleware>,
  chunks: LanguageModelV3StreamPart[],
): Promise<LanguageModelV3StreamPart[]> {
  if (!middleware.wrapStream) throw new Error("Expected stream middleware.");
  const result = await middleware.wrapStream({
    doGenerate: async () => {
      throw new Error("Not used by this test.");
    },
    doStream: async () => ({
      stream: new ReadableStream<LanguageModelV3StreamPart>({
        start(controller) {
          for (const chunk of chunks) controller.enqueue(chunk);
          controller.close();
        },
      }),
    }),
    model: undefined as never,
    params: undefined as never,
  });
  const output: LanguageModelV3StreamPart[] = [];
  for await (const chunk of result.stream) output.push(chunk);
  return output;
}
