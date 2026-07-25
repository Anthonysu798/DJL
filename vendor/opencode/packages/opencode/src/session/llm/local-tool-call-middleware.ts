import type { LanguageModelV3StreamPart } from "@ai-sdk/provider";
import type { LanguageModelMiddleware } from "ai";

type LocalTextToolCall = {
  readonly name: string;
  readonly arguments: Record<string, unknown>;
};

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stripCodeFence(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/iu, "")
    .replace(/\s*```$/u, "")
    .trim();
}

function splitJsonObjects(text: string): string[] | undefined {
  const input = text.trim();
  const objects: string[] = [];
  let index = 0;

  while (index < input.length) {
    while (/\s/u.test(input[index] ?? "")) index += 1;
    if (input[index] !== "{") return objects.length > 0 ? objects : undefined;
    const start = index;
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (; index < input.length; index += 1) {
      const character = input[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') inString = false;
        continue;
      }
      if (character === '"') inString = true;
      else if (character === "{") depth += 1;
      else if (character === "}") {
        depth -= 1;
        if (depth === 0) {
          index += 1;
          objects.push(input.slice(start, index));
          break;
        }
      }
    }
    if (depth !== 0 || inString) return undefined;
  }
  return objects.length > 0 ? objects : undefined;
}

function toolCallJsonBlocks(text: string): string[] | undefined {
  const normalized = stripCodeFence(text);
  if (!normalized.includes("<tool_call>")) return splitJsonObjects(normalized);

  const blocks: string[] = [];
  const remainder = normalized.replace(
    /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/giu,
    (_match, json: string) => {
      blocks.push(json);
      return "";
    },
  );
  return remainder.trim().length === 0 && blocks.length > 0 ? blocks : undefined;
}

function invalidMalformedCall(
  text: string,
  byLowercaseName: ReadonlyMap<string, string>,
): LocalTextToolCall | undefined {
  const malformedName =
    /^(?:<tool_call>\s*)?\{\s*"(?:name|function_name)"\s*:\s*"([\w.-]+)"/iu.exec(
      stripCodeFence(text),
    )?.[1];
  const invalid = byLowercaseName.get("invalid");
  if (!malformedName || !invalid) return undefined;
  return {
    name: invalid,
    arguments: {
      tool: malformedName,
      error: `The local model returned an incomplete or malformed call to "${malformedName}".`,
    },
  };
}

export function parseLocalTextToolCalls(
  text: string,
  availableTools: ReadonlySet<string>,
): LocalTextToolCall[] | undefined {
  const blocks = toolCallJsonBlocks(text);
  const byLowercaseName = new Map([...availableTools].map((name) => [name.toLowerCase(), name]));
  if (!blocks) {
    const invalid = invalidMalformedCall(text, byLowercaseName);
    return invalid ? [invalid] : undefined;
  }

  const calls: LocalTextToolCall[] = [];
  const seen = new Set<string>();
  for (const block of blocks) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(block);
    } catch {
      const invalid = invalidMalformedCall(block, byLowercaseName);
      if (!invalid) return undefined;
      calls.push(invalid);
      continue;
    }
    const value = record(parsed);
    const requestedName =
      value && typeof value.name === "string"
        ? value.name
        : value && typeof value.function_name === "string"
          ? value.function_name
          : undefined;
    if (!value || !requestedName) return undefined;
    const name = byLowercaseName.get(requestedName.toLowerCase());
    const invalid = byLowercaseName.get("invalid");
    if (!name) {
      if (!invalid) return undefined;
      const args = {
        tool: requestedName,
        error: `Unknown tool "${requestedName}" requested by the local model.`,
      };
      const key = `${invalid}:${JSON.stringify(args)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      calls.push({ name: invalid, arguments: args });
      continue;
    }
    let rawArguments = value.arguments;
    if (typeof rawArguments === "string") {
      try {
        rawArguments = JSON.parse(rawArguments);
      } catch {
        return undefined;
      }
    }
    const args = record(rawArguments);
    if (!args) return undefined;
    const key = `${name}:${JSON.stringify(args)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    calls.push({ name, arguments: args });
  }
  return calls.length > 0 ? calls : undefined;
}

type BufferedText = {
  readonly start: Extract<LanguageModelV3StreamPart, { type: "text-start" }>;
  mode: "undecided" | "candidate" | "streaming";
  buffer: string;
};

function couldBeToolCall(text: string): boolean | undefined {
  const trimmed = text.trimStart();
  if (trimmed.length === 0) return undefined;
  return trimmed.startsWith("{") || trimmed.startsWith("<") || trimmed.startsWith("```");
}

export function createLocalToolCallMiddleware(
  availableTools: ReadonlySet<string>,
): LanguageModelMiddleware {
  return {
    specificationVersion: "v3",
    wrapStream: async ({ doStream }) => {
      const { stream, ...rest } = await doStream();
      const textBlocks = new Map<string, BufferedText>();

      return {
        stream: stream.pipeThrough(
          new TransformStream<LanguageModelV3StreamPart, LanguageModelV3StreamPart>({
            transform(chunk, controller) {
              if (chunk.type === "text-start") {
                textBlocks.set(chunk.id, { start: chunk, mode: "undecided", buffer: "" });
                return;
              }

              if (chunk.type === "text-delta") {
                const block = textBlocks.get(chunk.id);
                if (!block) {
                  controller.enqueue(chunk);
                  return;
                }
                if (block.mode === "streaming") {
                  controller.enqueue(chunk);
                  return;
                }
                block.buffer += chunk.delta;
                const candidate = couldBeToolCall(block.buffer);
                if (candidate === undefined) return;
                if (candidate) {
                  block.mode = "candidate";
                  return;
                }
                block.mode = "streaming";
                controller.enqueue(block.start);
                controller.enqueue({ type: "text-delta", id: chunk.id, delta: block.buffer });
                block.buffer = "";
                return;
              }

              if (chunk.type === "text-end") {
                const block = textBlocks.get(chunk.id);
                if (!block) {
                  controller.enqueue(chunk);
                  return;
                }
                textBlocks.delete(chunk.id);
                if (block.mode === "streaming") {
                  controller.enqueue(chunk);
                  return;
                }

                const calls = parseLocalTextToolCalls(block.buffer, availableTools);
                if (!calls) {
                  controller.enqueue(block.start);
                  if (block.buffer.length > 0) {
                    controller.enqueue({ type: "text-delta", id: chunk.id, delta: block.buffer });
                  }
                  controller.enqueue(chunk);
                  return;
                }

                calls.forEach((call, index) => {
                  const id = `djl-local-${crypto.randomUUID()}-${index + 1}`;
                  const input = JSON.stringify(call.arguments);
                  controller.enqueue({ type: "tool-input-start", id, toolName: call.name });
                  controller.enqueue({
                    type: "tool-input-delta",
                    id,
                    delta: input,
                  });
                  controller.enqueue({ type: "tool-input-end", id });
                  controller.enqueue({
                    type: "tool-call",
                    toolCallId: id,
                    toolName: call.name,
                    input,
                  });
                });
                return;
              }

              controller.enqueue(chunk);
            },
          }),
        ),
        ...rest,
      };
    },
  };
}
