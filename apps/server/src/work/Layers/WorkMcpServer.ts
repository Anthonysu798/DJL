// FILE: WorkMcpServer.ts
// Purpose: Localhost-only, bearer-scoped Streamable HTTP MCP implementation for Work tools.

import { createHash, randomBytes } from "node:crypto";
import { lstat, mkdir, readdir, realpath } from "node:fs/promises";
import http from "node:http";
import path from "node:path";

import { ProjectId, ThreadId } from "@synara/contracts";
import { Effect, Layer, Ref } from "effect";

import {
  isSafeRegularAttachmentPath,
  parseAttachmentIdFromRelativePath,
  parseThreadSegmentFromAttachmentId,
  toSafeThreadAttachmentSegment,
} from "../../attachmentStore.ts";

import {
  comparePdfDeliverable,
  createOfficeDeliverable,
  mergePdfDeliverable,
  modifyOfficeDeliverable,
  redactPdfDeliverable,
  resolveAuthorizedInputPath,
  splitPdfDeliverable,
} from "../documentTools.ts";
import { normalizeWorkDocumentFile } from "../workDocumentPreview.ts";
import {
  WorkMcpServer,
  WorkMcpServerError,
  type WorkMcpServerShape,
} from "../Services/WorkMcpServer.ts";

const MAX_REQUEST_BYTES = 1024 * 1024;
const MAX_DIRECTORY_ENTRIES = 500;
const SUPPORTED_PROTOCOL_VERSIONS = new Set(["2025-06-18", "2025-03-26", "2024-11-05"]);

interface SessionScope {
  readonly threadId: ThreadId;
  readonly projectId: ProjectId;
  readonly authorizedRoot: string;
  readonly attachmentsRoot?: string;
}

interface JsonRpcRequest {
  readonly jsonrpc?: unknown;
  readonly id?: unknown;
  readonly method?: unknown;
  readonly params?: unknown;
}

interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  readonly annotations: {
    readonly title: string;
    readonly readOnlyHint: boolean;
    readonly destructiveHint: boolean;
    readonly idempotentHint: boolean;
    readonly openWorldHint: boolean;
  };
  readonly _meta: {
    readonly "djl/tool-classification":
      | "read"
      | "write-new"
      | "modify-copy"
      | "destructive"
      | "external";
  };
}

const TOOLS: ReadonlyArray<ToolDefinition> = [
  {
    name: "djl_list_files",
    description:
      "List files inside this DJL Work task's authorized folder. Never accesses other tasks.",
    inputSchema: {
      type: "object",
      properties: {
        directory: {
          type: "string",
          description: "Relative directory; defaults to the task root.",
        },
      },
      additionalProperties: false,
    },
    annotations: {
      title: "List task files",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    _meta: { "djl/tool-classification": "read" },
  },
  {
    name: "djl_read_document",
    description:
      "Extract cited text and structure from a PDF, Office document, image, or text file in this task.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
      additionalProperties: false,
    },
    annotations: {
      title: "Read document",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    _meta: { "djl/tool-classification": "read" },
  },
  {
    name: "djl_create_document",
    description:
      "Create a new versioned Word, Excel, PowerPoint, or PDF deliverable. Originals are never overwritten.",
    inputSchema: {
      type: "object",
      properties: {
        format: { type: "string", enum: ["docx", "xlsx", "pptx", "pdf"] },
        name: { type: "string" },
        title: { type: "string" },
        paragraphs: { type: "array", items: { type: "string" } },
        rows: { type: "array", items: { type: "array" } },
        slides: {
          type: "array",
          items: {
            type: "object",
            properties: { title: { type: "string" }, body: { type: "string" } },
            required: ["title", "body"],
            additionalProperties: false,
          },
        },
      },
      required: ["format", "name", "title"],
      additionalProperties: false,
    },
    annotations: {
      title: "Create Office deliverable",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    _meta: { "djl/tool-classification": "write-new" },
  },
  {
    name: "djl_modify_office_copy",
    description:
      "Create a versioned modified copy of a DOCX, XLSX, or PPTX file. DOCX/PPTX use exact text replacements; XLSX uses cell updates and appended rows. Originals are never overwritten.",
    inputSchema: {
      type: "object",
      properties: {
        inputPath: { type: "string" },
        name: { type: "string" },
        replacements: {
          type: "array",
          items: {
            type: "object",
            properties: {
              find: { type: "string" },
              replace: { type: "string" },
              caseSensitive: { type: "boolean" },
            },
            required: ["find", "replace"],
            additionalProperties: false,
          },
        },
        cellUpdates: {
          type: "array",
          items: {
            type: "object",
            properties: {
              sheet: { type: "string" },
              cell: { type: "string" },
              value: {},
              formula: { type: "string" },
            },
            required: ["sheet", "cell"],
            additionalProperties: false,
          },
        },
        appendRows: {
          type: "array",
          items: {
            type: "object",
            properties: {
              sheet: { type: "string" },
              rows: { type: "array", items: { type: "array" } },
            },
            required: ["sheet", "rows"],
            additionalProperties: false,
          },
        },
      },
      required: ["inputPath", "name"],
      additionalProperties: false,
    },
    annotations: {
      title: "Modify an Office copy",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    _meta: { "djl/tool-classification": "modify-copy" },
  },
  {
    name: "djl_merge_pdfs",
    description: "Merge two or more PDFs from this task into a new versioned PDF deliverable.",
    inputSchema: {
      type: "object",
      properties: {
        inputPaths: { type: "array", minItems: 2, items: { type: "string" } },
        name: { type: "string" },
      },
      required: ["inputPaths", "name"],
      additionalProperties: false,
    },
    annotations: {
      title: "Merge PDFs",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    _meta: { "djl/tool-classification": "modify-copy" },
  },
  {
    name: "djl_split_pdf",
    description: "Split selected pages of a task PDF into new versioned PDF deliverables.",
    inputSchema: {
      type: "object",
      properties: {
        inputPath: { type: "string" },
        name: { type: "string" },
        pages: { type: "array", items: { type: "integer", minimum: 1 } },
      },
      required: ["inputPath", "name"],
      additionalProperties: false,
    },
    annotations: {
      title: "Split PDF",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    _meta: { "djl/tool-classification": "modify-copy" },
  },
  {
    name: "djl_compare_pdfs",
    description:
      "Compare the extracted text of two task PDFs and create a cited, versioned PDF comparison report.",
    inputSchema: {
      type: "object",
      properties: {
        beforePath: { type: "string" },
        afterPath: { type: "string" },
        name: { type: "string" },
      },
      required: ["beforePath", "afterPath", "name"],
      additionalProperties: false,
    },
    annotations: {
      title: "Compare PDFs",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    _meta: { "djl/tool-classification": "modify-copy" },
  },
  {
    name: "djl_export_text_pdf",
    description:
      "Create an accessible, text-first PDF export from a task document. This preserves extracted structure and citations, not the source page layout.",
    inputSchema: {
      type: "object",
      properties: {
        inputPath: { type: "string" },
        name: { type: "string" },
        title: { type: "string" },
      },
      required: ["inputPath", "name", "title"],
      additionalProperties: false,
    },
    annotations: {
      title: "Export a text-first PDF",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    _meta: { "djl/tool-classification": "write-new" },
  },
  {
    name: "djl_redact_pdf",
    description:
      "Securely rebuild a PDF with literal terms removed, then verify they are no longer extractable.",
    inputSchema: {
      type: "object",
      properties: {
        inputPath: { type: "string" },
        name: { type: "string" },
        searchTerms: { type: "array", minItems: 1, items: { type: "string" } },
      },
      required: ["inputPath", "name", "searchTerms"],
      additionalProperties: false,
    },
    annotations: {
      title: "Securely redact PDF",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    _meta: { "djl/tool-classification": "modify-copy" },
  },
];

function tokenKey(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function isLoopbackAddress(address: string | undefined): boolean {
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Expected an object.");
  }
  return value as Record<string, unknown>;
}

function stringField(value: Record<string, unknown>, key: string): string {
  const field = value[key];
  if (typeof field !== "string" || field.trim().length === 0) {
    throw new Error(`'${key}' must be a non-empty string.`);
  }
  return field.trim();
}

function optionalStringArray(value: Record<string, unknown>, key: string): string[] | undefined {
  const field = value[key];
  if (field === undefined) return undefined;
  if (!Array.isArray(field) || field.some((item) => typeof item !== "string")) {
    throw new Error(`'${key}' must be an array of strings.`);
  }
  return field as string[];
}

async function normalizeScopedDocument(scope: SessionScope, filePath: string) {
  return normalizeWorkDocumentFile({
    filePath,
    threadId: scope.threadId,
    projectId: scope.projectId,
    scopeId: "mcp",
  });
}

async function scopedAttachmentInputFiles(scope: SessionScope): Promise<string[]> {
  if (!scope.attachmentsRoot) return [];
  const expectedThreadSegment = toSafeThreadAttachmentSegment(String(scope.threadId));
  if (!expectedThreadSegment) return [];
  const entries = await readdir(scope.attachmentsRoot, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries.slice(0, 10_000)) {
    if (!entry.isFile() || entry.isSymbolicLink()) continue;
    const attachmentId = parseAttachmentIdFromRelativePath(entry.name);
    if (
      !attachmentId ||
      parseThreadSegmentFromAttachmentId(attachmentId) !== expectedThreadSegment
    ) {
      continue;
    }
    const candidate = path.join(scope.attachmentsRoot, entry.name);
    if (
      isSafeRegularAttachmentPath({
        attachmentsDir: scope.attachmentsRoot,
        candidatePath: candidate,
      })
    ) {
      files.push(candidate);
    }
  }
  return files;
}

function jsonRpcResult(id: unknown, result: unknown): Record<string, unknown> {
  return { jsonrpc: "2.0", id: id ?? null, result };
}

function jsonRpcError(id: unknown, code: number, message: string): Record<string, unknown> {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

function toolSuccess(result: unknown): Record<string, unknown> {
  return {
    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    structuredContent: object(result),
    isError: false,
  };
}

function toolFailure(error: unknown): Record<string, unknown> {
  const message = error instanceof Error ? error.message : String(error);
  return { content: [{ type: "text", text: message.slice(0, 4_000) }], isError: true };
}

function scopedDisplayPath(scope: SessionScope, value: string): string {
  const resolved = path.resolve(value);
  const relative = path.relative(scope.authorizedRoot, resolved);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    return (relative || ".").split(path.sep).join("/");
  }
  // Task-owned immutable uploads live in DJL's private attachment store. Never expose
  // that store's absolute path (which can include usernames and state-directory names)
  // to a remote model.
  return `Attachments/${path.basename(resolved)}`;
}

function sanitizeToolResultPaths(scope: SessionScope, result: unknown): Record<string, unknown> {
  const record = object(result);
  return {
    ...record,
    ...(typeof record.path === "string" ? { path: scopedDisplayPath(scope, record.path) } : {}),
    ...(Array.isArray(record.paths) && record.paths.every((value) => typeof value === "string")
      ? { paths: record.paths.map((value) => scopedDisplayPath(scope, value)) }
      : {}),
  };
}

async function executeTool(
  scope: SessionScope,
  name: string,
  rawArguments: unknown,
): Promise<unknown> {
  const args = object(rawArguments ?? {});
  switch (name) {
    case "djl_list_files": {
      const directory = typeof args.directory === "string" ? args.directory : ".";
      const resolved =
        directory === "."
          ? scope.authorizedRoot
          : await resolveAuthorizedInputPath(scope.authorizedRoot, directory);
      const info = await lstat(resolved);
      if (!info.isDirectory()) throw new Error("The requested path is not a directory.");
      const entries = (await readdir(resolved, { withFileTypes: true })).slice(
        0,
        MAX_DIRECTORY_ENTRIES,
      );
      return {
        directory: path.relative(scope.authorizedRoot, resolved) || ".",
        entries: entries
          .filter((entry) => !entry.isSymbolicLink())
          .map((entry) => ({ name: entry.name, type: entry.isDirectory() ? "directory" : "file" })),
        truncated: entries.length === MAX_DIRECTORY_ENTRIES,
      };
    }
    case "djl_read_document": {
      const filePath = await resolveAuthorizedInputPath(
        scope.authorizedRoot,
        stringField(args, "path"),
        await scopedAttachmentInputFiles(scope),
      );
      const artifact = await normalizeScopedDocument(scope, filePath);
      return {
        path: scopedDisplayPath(scope, filePath),
        extractionMethod: artifact.extractionMethod,
        warnings: artifact.warnings,
        blocks: artifact.blocks.slice(0, 2_000),
      };
    }
    case "djl_create_document": {
      const format = stringField(args, "format");
      if (format !== "docx" && format !== "xlsx" && format !== "pptx" && format !== "pdf") {
        throw new Error("Unsupported document format.");
      }
      const rows = args.rows;
      const slides = args.slides;
      const paragraphs = optionalStringArray(args, "paragraphs");
      return createOfficeDeliverable({
        authorizedRoot: scope.authorizedRoot,
        format,
        name: stringField(args, "name"),
        title: stringField(args, "title"),
        ...(paragraphs ? { paragraphs } : {}),
        ...(Array.isArray(rows)
          ? { rows: rows.map((row) => (Array.isArray(row) ? row : [row])) }
          : {}),
        ...(Array.isArray(slides)
          ? {
              slides: slides.map((slide) => {
                const value = object(slide);
                return { title: stringField(value, "title"), body: stringField(value, "body") };
              }),
            }
          : {}),
      });
    }
    case "djl_modify_office_copy": {
      const replacements = Array.isArray(args.replacements)
        ? args.replacements.map((entry) => {
            const replacement = object(entry);
            const replace = replacement.replace;
            if (typeof replace !== "string") throw new Error("'replace' must be a string.");
            const caseSensitive = replacement.caseSensitive;
            if (caseSensitive !== undefined && typeof caseSensitive !== "boolean") {
              throw new Error("'caseSensitive' must be a boolean.");
            }
            return {
              find: stringField(replacement, "find"),
              replace,
              ...(caseSensitive === undefined ? {} : { caseSensitive }),
            };
          })
        : undefined;
      const cellUpdates = Array.isArray(args.cellUpdates)
        ? args.cellUpdates.map((entry) => {
            const update = object(entry);
            return {
              sheet: stringField(update, "sheet"),
              cell: stringField(update, "cell"),
              ...(Object.hasOwn(update, "value") ? { value: update.value } : {}),
              ...(typeof update.formula === "string" ? { formula: update.formula } : {}),
            };
          })
        : undefined;
      const appendRows = Array.isArray(args.appendRows)
        ? args.appendRows.map((entry) => {
            const append = object(entry);
            if (!Array.isArray(append.rows) || append.rows.some((row) => !Array.isArray(row))) {
              throw new Error("'rows' must be an array of row arrays.");
            }
            return {
              sheet: stringField(append, "sheet"),
              rows: append.rows as unknown[][],
            };
          })
        : undefined;
      return modifyOfficeDeliverable({
        authorizedRoot: scope.authorizedRoot,
        authorizedInputFiles: await scopedAttachmentInputFiles(scope),
        inputPath: stringField(args, "inputPath"),
        name: stringField(args, "name"),
        ...(replacements ? { replacements } : {}),
        ...(cellUpdates ? { cellUpdates } : {}),
        ...(appendRows ? { appendRows } : {}),
      });
    }
    case "djl_merge_pdfs": {
      const inputPaths = optionalStringArray(args, "inputPaths");
      if (!inputPaths) throw new Error("'inputPaths' is required.");
      return mergePdfDeliverable({
        authorizedRoot: scope.authorizedRoot,
        authorizedInputFiles: await scopedAttachmentInputFiles(scope),
        inputPaths,
        name: stringField(args, "name"),
      });
    }
    case "djl_split_pdf": {
      const pages = args.pages;
      return splitPdfDeliverable({
        authorizedRoot: scope.authorizedRoot,
        authorizedInputFiles: await scopedAttachmentInputFiles(scope),
        inputPath: stringField(args, "inputPath"),
        name: stringField(args, "name"),
        ...(Array.isArray(pages) && pages.every((page) => Number.isInteger(page))
          ? { pages: pages as number[] }
          : {}),
      });
    }
    case "djl_compare_pdfs":
      return comparePdfDeliverable({
        authorizedRoot: scope.authorizedRoot,
        authorizedInputFiles: await scopedAttachmentInputFiles(scope),
        beforePath: stringField(args, "beforePath"),
        afterPath: stringField(args, "afterPath"),
        name: stringField(args, "name"),
      });
    case "djl_export_text_pdf": {
      const filePath = await resolveAuthorizedInputPath(
        scope.authorizedRoot,
        stringField(args, "inputPath"),
        await scopedAttachmentInputFiles(scope),
      );
      const artifact = await normalizeScopedDocument(scope, filePath);
      if (artifact.blocks.length === 0) {
        throw new Error("No native text was available for a text-first PDF export.");
      }
      const sourceName = path.basename(filePath);
      return createOfficeDeliverable({
        authorizedRoot: scope.authorizedRoot,
        format: "pdf",
        name: stringField(args, "name"),
        title: stringField(args, "title"),
        paragraphs: [
          `Accessible text-first export. Source layout is not preserved. Source: ${sourceName}.`,
          ...artifact.blocks.map((block) => {
            const locator =
              block.locator.page !== undefined
                ? `page ${block.locator.page}`
                : block.locator.slide !== undefined
                  ? `slide ${block.locator.slide}`
                  : block.locator.sheet !== undefined
                    ? `sheet ${block.locator.sheet}, ${block.locator.cellRange ?? "cells"}`
                    : `paragraph ${block.locator.paragraph ?? "unknown"}`;
            return `[Source: ${sourceName}, ${locator}] ${block.text}`;
          }),
        ],
      });
    }
    case "djl_redact_pdf": {
      const searchTerms = optionalStringArray(args, "searchTerms");
      if (!searchTerms) throw new Error("'searchTerms' is required.");
      return redactPdfDeliverable({
        authorizedRoot: scope.authorizedRoot,
        authorizedInputFiles: await scopedAttachmentInputFiles(scope),
        inputPath: stringField(args, "inputPath"),
        name: stringField(args, "name"),
        searchTerms,
      });
    }
    default:
      throw new Error(`Unknown Work tool '${name}'.`);
  }
}

async function handleRpcRequest(
  scope: SessionScope,
  request: JsonRpcRequest,
): Promise<Record<string, unknown> | null> {
  if (request.jsonrpc !== "2.0" || typeof request.method !== "string") {
    return jsonRpcError(request.id, -32600, "Invalid Request");
  }
  if (request.id === undefined) return null;
  switch (request.method) {
    case "initialize": {
      const params =
        typeof request.params === "object" && request.params !== null
          ? (request.params as Record<string, unknown>)
          : {};
      const requestedVersion =
        typeof params.protocolVersion === "string" ? params.protocolVersion : "2025-03-26";
      return jsonRpcResult(request.id, {
        protocolVersion: SUPPORTED_PROTOCOL_VERSIONS.has(requestedVersion)
          ? requestedVersion
          : "2025-06-18",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "djl-work", title: "DJL Work Tools", version: "1.0.0" },
      });
    }
    case "ping":
      return jsonRpcResult(request.id, {});
    case "tools/list":
      return jsonRpcResult(request.id, { tools: TOOLS });
    case "tools/call": {
      const params = object(request.params);
      const name = stringField(params, "name");
      try {
        const result = await executeTool(scope, name, params.arguments);
        return jsonRpcResult(request.id, toolSuccess(sanitizeToolResultPaths(scope, result)));
      } catch (error) {
        return jsonRpcResult(request.id, toolFailure(error));
      }
    }
    default:
      return jsonRpcError(request.id, -32601, "Method not found");
  }
}

async function readJsonBody(request: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.byteLength;
    if (size > MAX_REQUEST_BYTES) throw new Error("MCP request body is too large.");
    chunks.push(bytes);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const make = Effect.gen(function* () {
  const addressRef = yield* Ref.make<string | null>(null);
  const scopes = new Map<string, SessionScope>();

  const requestHandler: http.RequestListener = (request, response) => {
    void (async () => {
      const address = await Effect.runPromise(Ref.get(addressRef));
      const expectedUrl = address ? new URL(address) : null;
      const expectedHost = expectedUrl?.host ?? null;
      if (
        !isLoopbackAddress(request.socket.remoteAddress) ||
        !expectedUrl ||
        !expectedHost ||
        (request.headers.host !== expectedHost &&
          request.headers.host !== `localhost:${expectedUrl.port}`)
      ) {
        response.writeHead(403, { "Content-Type": "text/plain", "Cache-Control": "no-store" });
        response.end("Forbidden");
        return;
      }
      if (request.url !== "/mcp" || request.method !== "POST") {
        response.writeHead(404, { "Content-Type": "text/plain", "Cache-Control": "no-store" });
        response.end("Not Found");
        return;
      }
      const authorization = request.headers.authorization;
      const rawToken = authorization?.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
      const scope = rawToken ? scopes.get(tokenKey(rawToken)) : undefined;
      if (!scope) {
        response.writeHead(401, {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
          "WWW-Authenticate": "Bearer",
        });
        response.end(JSON.stringify(jsonRpcError(null, -32001, "Unauthorized")));
        return;
      }
      try {
        const body = await readJsonBody(request);
        const requests = Array.isArray(body) ? body : [body];
        const results = (
          await Promise.all(
            requests.map((entry) => handleRpcRequest(scope, entry as JsonRpcRequest)),
          )
        ).filter((entry): entry is Record<string, unknown> => entry !== null);
        if (results.length === 0) {
          response.writeHead(202, { "Cache-Control": "no-store" });
          response.end();
          return;
        }
        response.writeHead(200, {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        });
        response.end(JSON.stringify(Array.isArray(body) ? results : results[0]));
      } catch (error) {
        response.writeHead(400, {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        });
        response.end(
          JSON.stringify(
            jsonRpcError(null, -32700, error instanceof Error ? error.message : "Parse error"),
          ),
        );
      }
    })().catch(() => {
      if (!response.headersSent) response.writeHead(500, { "Cache-Control": "no-store" });
      response.end();
    });
  };

  // Bind within the layer scope so the endpoint is ready before any provider
  // session can register and is always closed with the server runtime.
  const server = http.createServer(requestHandler);
  const address = yield* Effect.tryPromise({
    try: () =>
      new Promise<string>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
          server.off("error", reject);
          const bound = server.address();
          if (!bound || typeof bound === "string")
            reject(new Error("MCP server has no TCP address"));
          else resolve(`http://127.0.0.1:${bound.port}/mcp`);
        });
      }),
    catch: (cause) => new WorkMcpServerError({ operation: "start", detail: String(cause), cause }),
  });
  yield* Ref.set(addressRef, address);
  yield* Effect.addFinalizer(() =>
    Effect.promise(
      () =>
        new Promise<void>((resolve) => {
          scopes.clear();
          server.close(() => resolve());
        }),
    ),
  );

  const start: WorkMcpServerShape["start"] = Effect.void;

  const registerSession: WorkMcpServerShape["registerSession"] = (input) =>
    Effect.tryPromise({
      try: async () => {
        const address = await Effect.runPromise(Ref.get(addressRef));
        if (!address) throw new Error("Work MCP server is not started.");
        const root = await realpath(input.authorizedRoot);
        const info = await lstat(root);
        if (!info.isDirectory() || info.isSymbolicLink()) {
          throw new Error("The authorized Work root is not a safe directory.");
        }
        const bearerToken = randomBytes(32).toString("base64url");
        if (input.attachmentsRoot) {
          await mkdir(input.attachmentsRoot, { recursive: true, mode: 0o700 });
        }
        const attachmentsRoot = input.attachmentsRoot
          ? await realpath(input.attachmentsRoot)
          : undefined;
        if (attachmentsRoot) {
          const attachmentsInfo = await lstat(attachmentsRoot);
          if (!attachmentsInfo.isDirectory() || attachmentsInfo.isSymbolicLink()) {
            throw new Error("The Work attachment root is not a safe directory.");
          }
        }
        scopes.set(tokenKey(bearerToken), {
          threadId: input.threadId,
          projectId: input.projectId ?? ProjectId.makeUnsafe(`work-${input.threadId}`),
          authorizedRoot: root,
          ...(attachmentsRoot ? { attachmentsRoot } : {}),
        });
        return {
          name: `djl_work_${createHash("sha256").update(input.threadId).digest("hex").slice(0, 12)}`,
          url: address,
          bearerToken,
        };
      },
      catch: (cause) =>
        new WorkMcpServerError({
          operation: "registerSession",
          detail: cause instanceof Error ? cause.message : String(cause),
          cause,
        }),
    });

  const unregisterSession: WorkMcpServerShape["unregisterSession"] = (bearerToken) =>
    Effect.sync(() => {
      scopes.delete(tokenKey(bearerToken));
    });

  return { start, registerSession, unregisterSession } satisfies WorkMcpServerShape;
});

export const WorkMcpServerLive = Layer.effect(WorkMcpServer, make);
