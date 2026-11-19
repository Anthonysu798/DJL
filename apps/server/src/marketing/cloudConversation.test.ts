import { afterEach, describe, it, expect, vi } from "vitest";
import { runMarketingConversation } from "./cloudConversation";
afterEach(() => vi.useRealTimers());
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

const stream = (value: unknown) =>
  new Response(`data: ${JSON.stringify(value)}\n\ndata: [DONE]\n\n`);

describe("Cloud SSE admission errors", () => {
  it.each([
    ["rate_limited", "Too many requests. Retry in 1s.", 1000],
    ["provider_rate_limited", "The model provider returned an error.", 5000],
  ])("retries %s without replaying a completed tool", async (code, message, delay) => {
    vi.useFakeTimers();
    const execute = vi.fn().mockResolvedValue({ stopped: true });
    const request = vi
      .fn()
      .mockResolvedValueOnce(
        stream({
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: "stop",
                    function: { name: "djl_computer_stop", arguments: "{}" },
                  },
                ],
              },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(stream({ error: { code, message } }))
      .mockResolvedValueOnce(
        stream({ choices: [{ delta: { content: "Verified and stopped." } }] }),
      );
    const result = runMarketingConversation({
      messages: [],
      model: "test",
      signal: new AbortController().signal,
      stream: request,
      execute,
      onTool: () => {},
      tools: [{ name: "djl_computer_stop", description: "Stop", inputSchema: {} }],
    });
    void result.catch(() => {});
    await vi.advanceTimersByTimeAsync(Number(delay) - 1);
    expect(request).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toBe("Verified and stopped.");
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it.each([
    { content: "Partial answer" },
    {
      tool_calls: [
        { index: 0, id: "partial", function: { name: "djl_marketing_status", arguments: "{" } },
      ],
    },
    { reasoning_content: "Partial reasoning" },
  ])("never retries an error after partial model output %j", async (delta) => {
    const request = vi
      .fn()
      .mockImplementation(
        async () =>
          new Response(
            `data: ${JSON.stringify({ choices: [{ delta }] })}\n\ndata: ${JSON.stringify({ error: { code: "provider_rate_limited", message: "Limited" } })}\n\n`,
          ),
      );
    const execute = vi.fn();
    await expect(
      runMarketingConversation({
        messages: [],
        model: "test",
        signal: new AbortController().signal,
        stream: request,
        execute,
        onTool: () => {},
      }),
    ).rejects.toThrow("Limited");
    expect(request).toHaveBeenCalledTimes(1);
    expect(execute).not.toHaveBeenCalled();
  });

  it("bounds empty-stream retries and cancels the wait", async () => {
    vi.useFakeTimers();
    const request = vi
      .fn()
      .mockImplementation(async () =>
        stream({ error: { code: "provider_rate_limited", message: "Limited" } }),
      );
    const input = {
      messages: [],
      model: "test",
      signal: new AbortController().signal,
      stream: request,
      execute: vi.fn(),
      onTool: () => {},
    };
    const result = runMarketingConversation(input);
    const assertion = expect(result).rejects.toThrow("Limited");
    void assertion.catch(() => {});
    await vi.runAllTimersAsync();
    await assertion;
    expect(request).toHaveBeenCalledTimes(3);
    request.mockClear();
    const controller = new AbortController();
    const aborted = runMarketingConversation({ ...input, signal: controller.signal });
    const abortAssertion = expect(aborted).rejects.toMatchObject({ name: "AbortError" });
    void abortAssertion.catch(() => {});
    await vi.advanceTimersByTimeAsync(1);
    controller.abort();
    await vi.runAllTimersAsync();
    await abortAssertion;
    expect(request).toHaveBeenCalledTimes(1);
    expect(input.execute).not.toHaveBeenCalled();
  });
});
