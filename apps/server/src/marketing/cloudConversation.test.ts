import { describe, it, expect } from "vitest";
import { runMarketingConversation } from "./cloudConversation";
describe("cloud marketing tool execution", () => {
  it("executes bounded real tool calls before returning the assistant response", async () => {
    let calls = 0;
    const executed: string[] = [];
    const result = await runMarketingConversation({
      messages: [{ role: "user", content: "Prepare a campaign" }],
      model: "test",
      signal: new AbortController().signal,
      stream: async () => {
        calls++;
        const delta =
          calls === 1
            ? {
                tool_calls: [
                  {
                    index: 0,
                    id: "call1",
                    function: { name: "djl_marketing_status", arguments: "{}" },
                  },
                ],
              }
            : { content: "Here is your preview." };
        return new Response(
          `data: ${JSON.stringify({ choices: [{ delta }] })}\n\ndata: [DONE]\n\n`,
        );
      },
      execute: async (name) => {
        executed.push(name);
        return { campaigns: [] };
      },
      onTool: () => {},
    });
    expect(executed).toEqual(["djl_marketing_status"]);
    expect(result).toBe("Here is your preview.");
    expect(calls).toBe(2);
  });
  it("never executes an unregistered tool name", async () => {
    let executed = false;
    await expect(
      runMarketingConversation({
        messages: [],
        model: "test",
        signal: new AbortController().signal,
        stream: async () =>
          new Response(
            'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"bad","function":{"name":"publish_now","arguments":"{}"}}]}}]}\n\ndata: [DONE]\n\n',
          ),
        execute: async () => {
          executed = true;
          return {};
        },
        onTool: () => {},
      }),
    ).rejects.toThrow("Unsupported");
    expect(executed).toBe(false);
  });
});
