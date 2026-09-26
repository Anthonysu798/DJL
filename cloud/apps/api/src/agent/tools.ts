/**
 * Agent tool contract. Every tool has a strict JSON schema (OpenAI strict
 * mode: every property required, nothing extra), a per-run quota, and no
 * side effects outside DJL: tools read the web and the user's own files,
 * compute in the sandbox, or make images that are saved as the user's files.
 *
 * Tool output is untrusted. It reaches the model only inside
 * <untrusted source="..."> tags, and the system prompt says to treat it as
 * data, never as instructions.
 */
import type { CloudMessagePart } from "@synara/contracts/cloud";
import type { ToolDefinition } from "@djl/providers";

import type { FileRow } from "../files/FileService.ts";
import type { RequestFacts } from "../gateway/GatewayService.ts";
import type { RunRow } from "../runs/wire.ts";
import type { SandboxSession } from "./sandbox/Sandbox.ts";
import type { ToolPriceKey } from "./ToolBilling.ts";

interface JsonProperty {
  readonly type: "string";
  readonly description: string;
  readonly maxLength?: number;
  readonly enum?: readonly string[];
}

export interface ToolSchema {
  readonly type: "object";
  readonly properties: Readonly<Record<string, JsonProperty>>;
  readonly required: readonly string[];
  readonly additionalProperties: false;
}

export interface ToolContext {
  readonly run: RunRow;
  readonly facts: RequestFacts;
  readonly signal: AbortSignal;
  /** Provenance: URLs from this run's search results and from the user's own messages. */
  readonly allowedUrls: ReadonlySet<string>;
  /** A file attached or generated in this conversation, owned by the run's user; else null. */
  readonly file: (fileId: string) => Promise<FileRow | null>;
  /** Charge a priced tool through the ledger; the cost counts toward the run's cap. */
  readonly charge: <T>(
    tool: ToolPriceKey,
    maxUnits: number,
    work: () => Promise<{ readonly value: T; readonly units: number }>,
  ) => Promise<T>;
  /** The run's sandbox machine, created on first use and destroyed when the run ends. */
  readonly sandbox: () => Promise<SandboxSession>;
}

export interface ToolOutput {
  /** What the model sees (wrapped as untrusted) and what the tool_result part stores. */
  readonly content: string;
  readonly isError?: boolean;
  /** Parts added to the reply after the result, e.g. a generated image. */
  readonly parts?: readonly CloudMessagePart[];
}

export interface AgentTool {
  readonly name: string;
  readonly description: string;
  readonly parameters: ToolSchema;
  /** Most calls of this tool in one run. */
  readonly quota: number;
  readonly run: (args: Readonly<Record<string, unknown>>, ctx: ToolContext) => Promise<ToolOutput>;
}

/** A failure the model should see and may recover from (bad input, missing file, blocked URL). */
export class ToolError extends Error {
  readonly _tag = "ToolError";
}

export const MAX_TOOL_OUTPUT_CHARS = 12_000;

export function truncate(text: string, max = MAX_TOOL_OUTPUT_CHARS): string {
  return text.length <= max
    ? text
    : `${text.slice(0, max)}\n[truncated ${text.length - max} characters]`;
}

export const toolDefinition = (tool: AgentTool): ToolDefinition => ({
  type: "function",
  function: {
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters as unknown as Record<string, unknown>,
    strict: true,
  },
});

/** Parses and checks model-produced arguments against the tool's schema. */
export function parseArgs(schema: ToolSchema, raw: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(raw || "{}");
  } catch {
    throw new ToolError("The arguments are not valid JSON.");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new ToolError("The arguments must be a JSON object.");
  const args = value as Record<string, unknown>;
  for (const key of Object.keys(args))
    if (!(key in schema.properties)) throw new ToolError(`Unknown argument "${key}".`);
  for (const [key, spec] of Object.entries(schema.properties)) {
    const v = args[key];
    if (typeof v !== "string" || v.trim() === "")
      throw new ToolError(`"${key}" must be a non-empty string.`);
    if (spec.maxLength && v.length > spec.maxLength)
      throw new ToolError(`"${key}" is longer than ${spec.maxLength} characters.`);
    if (spec.enum && !spec.enum.includes(v))
      throw new ToolError(`"${key}" must be one of ${spec.enum.join(", ")}.`);
  }
  return args;
}

const escapeAttr = (s: string) =>
  s
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

/** Tool output as model input: tagged as untrusted, with any forged closing tag defused. */
export function wrapUntrusted(source: string, content: string): string {
  const body = content.replace(/<\s*\/?\s*untrusted/gi, (m) => m.replace("<", "&lt;"));
  return `<untrusted source="${escapeAttr(source.slice(0, 300))}">\n${body}\n</untrusted>`;
}

/** Where a tool's output came from, as named in its untrusted wrapper. */
export function sourceOf(name: string, args: Readonly<Record<string, unknown>>): string {
  const detail = args.url ?? args.query ?? args.file_id;
  return typeof detail === "string" ? `${name}:${detail}` : name;
}
