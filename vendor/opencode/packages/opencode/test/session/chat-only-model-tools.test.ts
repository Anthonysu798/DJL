import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { LLMRequestPrep } from "@/session/llm/request";
import { jsonSchema } from "ai";

const sessionID = "test-session-chat-only";

const localModel = (toolcall: boolean) =>
  ({
    id: "ollama/llama3.2:1b",
    modelID: "llama3.2:1b",
    providerID: "ollama",
    name: "llama3.2:1b",
    api: { id: "llama3.2:1b", url: "http://127.0.0.1:11434/v1", npm: "@ai-sdk/openai-compatible" },
    capabilities: {
      temperature: true,
      reasoning: false,
      attachment: false,
      toolcall,
      input: { text: true, audio: false, image: false, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: { input: 0, output: 0 },
    limit: { context: 8192, output: 8192 },
    status: "active",
    options: {},
    headers: {},
  }) as any;

const prepare = (toolcall: boolean) =>
  Effect.runPromise(
    LLMRequestPrep.prepare({
      user: {
        id: "msg_user-chat-only",
        sessionID,
        role: "user",
        time: { created: 0 },
        agent: "build",
        model: { providerID: "ollama", modelID: "llama3.2:1b" },
      } as any,
      sessionID,
      model: localModel(toolcall),
      agent: { name: "build", mode: "primary", options: {}, permission: [] } as any,
      system: [],
      messages: [{ role: "user", content: "hi" }],
      tools: {
        read: {
          description: "Read a file or directory from the local filesystem.",
          inputSchema: jsonSchema({ type: "object", properties: {} }),
        },
      },
      provider: { id: "ollama", options: {} } as any,
      auth: undefined,
      plugin: {
        trigger: (_name: string, _input: unknown, output: unknown) => Effect.succeed(output),
        list: () => Effect.succeed([]),
        init: () => Effect.void,
      } as any,
      flags: { outputTokenMax: 8_192, client: "test" } as any,
      isWorkflow: false,
    }),
  );

describe("chat-only models", () => {
  test("a model declared unable to call tools is sent none", async () => {
    // Ollama renders every tool definition into the prompt itself. A model too small to call them
    // does not ignore them — it echoes them back as chat text, which reads as DJL being broken.
    const result = await prepare(false);
    expect(Object.keys(result.tools)).toEqual([]);
  });

  test("a tool-capable model keeps its tools", async () => {
    const result = await prepare(true);
    expect(Object.keys(result.tools)).toEqual(["read"]);
  });
});
