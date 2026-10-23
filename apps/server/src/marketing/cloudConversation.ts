import { MARKETING_TOOLS } from "./chatTools";
interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}
export async function runMarketingConversation(input: {
  messages: Record<string, unknown>[];
  model: string;
  signal: AbortSignal;
  stream: (body: unknown, signal: AbortSignal) => Promise<Response>;
  execute: (name: string, args: unknown) => Promise<unknown>;
  onTool: (name: string, id: string, result: unknown) => void;
}) {
  const messages = input.messages;
  for (let round = 0; round < 8; round++) {
    input.signal.throwIfAborted();
    const response = await input.stream(
      {
        model: input.model,
        stream: true,
        max_tokens: 4096,
        messages,
        tools: MARKETING_TOOLS.map((tool) => ({
          type: "function",
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.inputSchema,
          },
        })),
      },
      input.signal,
    );
    if (!response.body) throw new Error("The model returned no response.");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = "";
    let text = "";
    let doneMarker = false;
    let total = 0;
    const calls = new Map<number, ToolCall>();
    const consume = (block: string) => {
      const data = block
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trim())
        .join("\n");
      if (!data) return;
      if (data === "[DONE]") {
        doneMarker = true;
        return;
      }
      const value = JSON.parse(data) as {
        error?: { message?: string };
        cutOff?: boolean;
        choices?: {
          finish_reason?: string;
          delta?: {
            content?: string;
            tool_calls?: {
              index: number;
              id?: string;
              function?: { name?: string; arguments?: string };
            }[];
          };
        }[];
      };
      if (value.error || value.cutOff)
        throw new Error(value.error?.message ?? "Generation stopped before completion.");
      const choice = value.choices?.[0];
      if (choice?.finish_reason === "length")
        throw new Error("The campaign response was truncated. Please retry.");
      text += choice?.delta?.content ?? "";
      for (const part of choice?.delta?.tool_calls ?? []) {
        if (!Number.isInteger(part.index) || part.index < 0 || part.index > 7)
          throw new Error("Too many tool calls.");
        const call = calls.get(part.index) ?? { id: "", name: "", arguments: "" };
        call.id = part.id ?? call.id;
        call.name += part.function?.name ?? "";
        call.arguments += part.function?.arguments ?? "";
        calls.set(part.index, call);
      }
    };
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > 2 * 1024 * 1024) throw new Error("Model response is too large.");
        pending += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
        let end: number;
        while ((end = pending.indexOf("\n\n")) >= 0) {
          consume(pending.slice(0, end));
          pending = pending.slice(end + 2);
        }
      }
      if (pending.trim()) consume(pending);
      if (!doneMarker) throw new Error("The model connection ended unexpectedly.");
    } finally {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
    if (!calls.size) {
      messages.push({ role: "assistant", content: text });
      return text;
    }
    const batch = [...calls.values()];
    if (batch.some((call) => !MARKETING_TOOLS.some((t) => t.name === call.name) || !call.id))
      throw new Error("Unsupported marketing tool requested.");
    messages.push({
      role: "assistant",
      content: text || null,
      tool_calls: batch.map((call) => ({
        id: call.id,
        type: "function",
        function: { name: call.name, arguments: call.arguments },
      })),
    });
    for (const call of batch) {
      input.signal.throwIfAborted();
      let result: unknown;
      try {
        result = await input.execute(call.name, JSON.parse(call.arguments));
      } catch (e) {
        result = { error: e instanceof Error ? e.message : "Campaign operation failed." };
      }
      input.onTool(call.name, call.id, result);
      messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
    }
  }
  throw new Error(
    "DJL reached the campaign preparation step limit. Your saved preview is preserved.",
  );
}
