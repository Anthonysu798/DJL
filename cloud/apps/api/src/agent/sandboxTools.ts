/**
 * read_file and python. Documents that need a parser (PDF, docx, xlsx) are
 * parsed inside the sandbox, never in this process; plain text formats are
 * read directly with a size cap. Python runs only in the sandbox. Sandbox
 * time is billed per second at the `sandbox_second` price.
 */
import { eq } from "drizzle-orm";
import { schema, type DjlDatabase } from "@djl/db";

import { DOWNLOAD_URL_SECONDS } from "../files/FileService.ts";
import type { BlobStore } from "../sync/BlobStore.ts";
import { EXEC_TIMEOUT_SECONDS } from "./sandbox/FlyMachines.ts";
import { MAX_CODE_CHARS, type ExecResult } from "./sandbox/Sandbox.ts";
import { ToolError, truncate, type AgentTool } from "./tools.ts";

const TEXT_TYPES = new Set(["text/plain", "text/markdown", "text/csv", "application/json"]);
const PARSED_TYPES: Readonly<Record<string, string>> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
};
const MAX_TEXT_FILE_BYTES = 1024 * 1024;
/** Extracted text kept on the file row so a second read costs nothing. */
const MAX_STORED_TEXT = 200_000;
/** Seconds reserved per sandbox call: the exec limit plus machine start-up. */
const SANDBOX_RESERVE_SECONDS = EXEC_TIMEOUT_SECONDS * 2 + 30;

function describeExec(result: ExecResult): string {
  return [
    `exit code ${result.exitCode}`,
    result.stdout ? `stdout:\n${result.stdout}` : "stdout: (empty)",
    ...(result.stderr ? [`stderr:\n${result.stderr}`] : []),
  ].join("\n");
}

export function createSandboxTools(deps: {
  readonly db: DjlDatabase;
  readonly blobs: BlobStore;
}): AgentTool[] {
  const readFile: AgentTool = {
    name: "read_file",
    description:
      "Read the text of a file the user attached to this conversation (text, CSV, Markdown, JSON, PDF, Word, or Excel).",
    parameters: {
      type: "object",
      properties: {
        file_id: { type: "string", description: "The attached file's file_id.", maxLength: 64 },
      },
      required: ["file_id"],
      additionalProperties: false,
    },
    quota: 10,
    async run(args, ctx) {
      const file = await ctx.file(String(args.file_id));
      if (!file) throw new ToolError("No attached file with that file_id in this conversation.");
      if (file.mimeType.startsWith("image/"))
        return {
          content:
            "This is an image. It is already included in the conversation for you to look at.",
        };
      if (file.textContent) return { content: truncate(file.textContent) };
      if (TEXT_TYPES.has(file.mimeType)) {
        if (file.sizeBytes > MAX_TEXT_FILE_BYTES)
          throw new ToolError("This file is too large to read (the limit is 1 MB of text).");
        const bytes = await deps.blobs.read(file.storageKey);
        if (!bytes) throw new ToolError("This file is no longer available.");
        return { content: truncate(new TextDecoder().decode(bytes)) };
      }
      const extension = PARSED_TYPES[file.mimeType];
      if (!extension) throw new ToolError(`Files of type ${file.mimeType} cannot be read.`);
      const { url } = await deps.blobs.presignDownload(file.storageKey, DOWNLOAD_URL_SECONDS);
      const sandbox = await ctx.sandbox();
      const result = await ctx.charge("sandbox_second", SANDBOX_RESERVE_SECONDS, async () => {
        const r = await sandbox.extractText({ url, extension }, ctx.signal);
        return { value: r, units: r.seconds };
      });
      if (result.exitCode !== 0) throw new ToolError("The file could not be parsed.");
      const text = result.stdout.slice(0, MAX_STORED_TEXT);
      await deps.db
        .update(schema.files)
        .set({ textContent: text })
        .where(eq(schema.files.id, file.id));
      return { content: truncate(text) };
    },
  };

  const python: AgentTool = {
    name: "python",
    description:
      "Run Python 3 code in an isolated sandbox with numpy, pandas, and matplotlib. There is no network and no access to the user's files; print what you need. Each run is limited to 60 seconds.",
    parameters: {
      type: "object",
      properties: {
        code: {
          type: "string",
          description: "The Python source to run.",
          maxLength: MAX_CODE_CHARS,
        },
      },
      required: ["code"],
      additionalProperties: false,
    },
    quota: 12,
    async run(args, ctx) {
      const sandbox = await ctx.sandbox();
      const result = await ctx.charge("sandbox_second", SANDBOX_RESERVE_SECONDS, async () => {
        const r = await sandbox.runPython(String(args.code), ctx.signal);
        return { value: r, units: r.seconds };
      });
      return { content: truncate(describeExec(result)), isError: result.exitCode !== 0 };
    },
  };

  return [readFile, python];
}
