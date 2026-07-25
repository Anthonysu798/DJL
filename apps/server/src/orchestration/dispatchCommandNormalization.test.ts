// FILE: dispatchCommandNormalization.test.ts
// Purpose: Verifies client command normalization for managed workspaces and uploads.

import fs from "node:fs";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";

import {
  CommandId,
  MessageId,
  type ClientOrchestrationCommand,
  ProjectId,
  ThreadId,
} from "@synara/contracts";
import { Effect } from "effect";
import type { FileSystem, Path } from "effect";
import { describe, expect, it } from "vitest";

import {
  makeDispatchCommandNormalizer,
  type DispatchCommandNormalizerResult,
} from "./dispatchCommandNormalization";

function projectCreateCommand(
  overrides: Partial<Extract<ClientOrchestrationCommand, { type: "project.create" }>> = {},
): Extract<ClientOrchestrationCommand, { type: "project.create" }> {
  return {
    type: "project.create",
    commandId: CommandId.makeUnsafe("cmd-project-create"),
    projectId: ProjectId.makeUnsafe("project-chat"),
    kind: "chat",
    title: "Chat",
    workspaceRoot: "/Users/tester/Documents/Synara/2026-06-11/chat",
    createWorkspaceRootIfMissing: true,
    createdAt: "2026-06-11T21:30:43.000Z",
    ...overrides,
  };
}

// Runs the normalized command's deferred `prepareWorkspaceRoot` effect (if any), mirroring
// what the wsRpc dispatchCommand handler does after a successful `orchestrationEngine.dispatch`.
async function runPrepareWorkspaceRoot<E>(result: DispatchCommandNormalizerResult<E>) {
  if (result.prepareWorkspaceRoot) {
    await Effect.runPromise(result.prepareWorkspaceRoot);
  }
}

describe("makeDispatchCommandNormalizer", () => {
  it("returns a deferred prepare effect instead of scaffolding during normalization", async () => {
    const preparedRoots: string[] = [];
    const normalizer = makeDispatchCommandNormalizer<Error>({
      attachmentsDir: "/tmp/attachments",
      chatWorkspaceRoot: "/Users/tester/Documents/Synara",
      fileSystem: {} as FileSystem.FileSystem,
      path: {} as Path.Path,
      canonicalizeProjectWorkspaceRoot: (workspaceRoot) => Effect.succeed(workspaceRoot),
      prepareChatWorkspaceRoot: (workspaceRoot) =>
        Effect.sync(() => {
          preparedRoots.push(workspaceRoot);
        }),
    });

    const result = await Effect.runPromise(normalizer({ command: projectCreateCommand() }));

    // Normalization alone must not have scaffolded anything yet.
    expect(preparedRoots).toEqual([]);
    expect(result.prepareWorkspaceRoot).not.toBeNull();

    await runPrepareWorkspaceRoot(result);

    // Only after the caller explicitly runs the deferred effect does scaffolding happen.
    expect(preparedRoots).toEqual(["/Users/tester/Documents/Synara/2026-06-11/chat"]);
  });

  it("retries the deferred prepare effect on transient failures before succeeding", async () => {
    let callCount = 0;
    const normalizer = makeDispatchCommandNormalizer<Error>({
      attachmentsDir: "/tmp/attachments",
      chatWorkspaceRoot: "/Users/tester/Documents/Synara",
      fileSystem: {} as FileSystem.FileSystem,
      path: {} as Path.Path,
      canonicalizeProjectWorkspaceRoot: (workspaceRoot) => Effect.succeed(workspaceRoot),
      prepareChatWorkspaceRoot: () =>
        Effect.suspend(() => {
          callCount += 1;
          if (callCount < 3) {
            return Effect.fail(new Error("transient FS error"));
          }
          return Effect.void;
        }),
    });

    const result = await Effect.runPromise(normalizer({ command: projectCreateCommand() }));
    expect(result.prepareWorkspaceRoot).not.toBeNull();

    await runPrepareWorkspaceRoot(result);

    expect(callCount).toBe(3);
  });

  it("prepares managed date/slug chat workspace roots", async () => {
    const preparedRoots: string[] = [];
    const normalizer = makeDispatchCommandNormalizer<Error>({
      attachmentsDir: "/tmp/attachments",
      chatWorkspaceRoot: "/Users/tester/Documents/Synara",
      fileSystem: {} as FileSystem.FileSystem,
      path: {} as Path.Path,
      canonicalizeProjectWorkspaceRoot: (workspaceRoot) => Effect.succeed(workspaceRoot),
      prepareChatWorkspaceRoot: (workspaceRoot) =>
        Effect.sync(() => {
          preparedRoots.push(workspaceRoot);
        }),
    });

    const result = await Effect.runPromise(normalizer({ command: projectCreateCommand() }));
    await runPrepareWorkspaceRoot(result);

    expect(preparedRoots).toEqual(["/Users/tester/Documents/Synara/2026-06-11/chat"]);
  });

  it("does not prepare ordinary projects or the chat workspace root itself", async () => {
    const preparedRoots: string[] = [];
    const normalizer = makeDispatchCommandNormalizer<Error>({
      attachmentsDir: "/tmp/attachments",
      chatWorkspaceRoot: "/Users/tester/Documents/Synara",
      fileSystem: {} as FileSystem.FileSystem,
      path: {} as Path.Path,
      canonicalizeProjectWorkspaceRoot: (workspaceRoot) => Effect.succeed(workspaceRoot),
      prepareChatWorkspaceRoot: (workspaceRoot) =>
        Effect.sync(() => {
          preparedRoots.push(workspaceRoot);
        }),
    });

    const first = await Effect.runPromise(
      normalizer({
        command: projectCreateCommand({
          kind: "project",
          workspaceRoot: "/Users/tester/Documents/Synara/2026-06-11/app",
        }),
      }),
    );
    await runPrepareWorkspaceRoot(first);
    const second = await Effect.runPromise(
      normalizer({
        command: projectCreateCommand({
          workspaceRoot: "/Users/tester/Documents/Synara",
        }),
      }),
    );
    await runPrepareWorkspaceRoot(second);

    expect(preparedRoots).toEqual([]);
  });

  it("prepares the Studio workspace root itself", async () => {
    const preparedRoots: string[] = [];
    const normalizer = makeDispatchCommandNormalizer<Error>({
      attachmentsDir: "/tmp/attachments",
      chatWorkspaceRoot: "/Users/tester/Documents/Synara",
      studioWorkspaceRoot: "/Users/tester/Documents/Synara/Studio",
      fileSystem: {} as FileSystem.FileSystem,
      path: {} as Path.Path,
      canonicalizeProjectWorkspaceRoot: (workspaceRoot) => Effect.succeed(workspaceRoot),
      prepareChatWorkspaceRoot: () => Effect.void,
      prepareStudioWorkspaceRoot: (workspaceRoot) =>
        Effect.sync(() => {
          preparedRoots.push(workspaceRoot);
        }),
    });

    const result = await Effect.runPromise(
      normalizer({
        command: projectCreateCommand({
          kind: "studio",
          title: "Studio",
          workspaceRoot: "/Users/tester/Documents/Synara/Studio",
        }),
      }),
    );
    await runPrepareWorkspaceRoot(result);

    expect(preparedRoots).toEqual(["/Users/tester/Documents/Synara/Studio"]);
  });

  it("prepares nested Studio workspace roots but not ordinary projects under Studio", async () => {
    const preparedRoots: string[] = [];
    const normalizer = makeDispatchCommandNormalizer<Error>({
      attachmentsDir: "/tmp/attachments",
      studioWorkspaceRoot: "/Users/tester/Documents/Synara/Studio",
      fileSystem: {} as FileSystem.FileSystem,
      path: {} as Path.Path,
      canonicalizeProjectWorkspaceRoot: (workspaceRoot) => Effect.succeed(workspaceRoot),
      prepareStudioWorkspaceRoot: (workspaceRoot) =>
        Effect.sync(() => {
          preparedRoots.push(workspaceRoot);
        }),
    });

    const first = await Effect.runPromise(
      normalizer({
        command: projectCreateCommand({
          kind: "studio",
          workspaceRoot: "/Users/tester/Documents/Synara/Studio/Outbox",
        }),
      }),
    );
    await runPrepareWorkspaceRoot(first);
    const second = await Effect.runPromise(
      normalizer({
        command: projectCreateCommand({
          kind: "project",
          workspaceRoot: "/Users/tester/Documents/Synara/Studio/SomeProject",
        }),
      }),
    );
    await runPrepareWorkspaceRoot(second);

    expect(preparedRoots).toEqual(["/Users/tester/Documents/Synara/Studio/Outbox"]);
  });

  it("validates and reuses immutable streaming references without rewriting bytes", async () => {
    const attachmentsDir = fs.mkdtempSync(path.join(os.tmpdir(), "djl-dispatch-stream-ref-"));
    const bytes = Buffer.from("%PDF-1.7\nstreamed");
    const contentHash = createHash("sha256").update(bytes).digest("hex");
    const id = `thread-stream-ref-${contentHash.slice(0, 8)}-${contentHash.slice(8, 12)}-${contentHash.slice(12, 16)}-${contentHash.slice(16, 20)}-${contentHash.slice(20, 32)}`;
    const storedPath = path.join(attachmentsDir, `${id}.pdf`);
    fs.writeFileSync(storedPath, bytes);
    let writeCount = 0;
    const fileSystem = {
      stat: (filePath: string) =>
        Effect.tryPromise({
          try: async () => {
            const stat = await fs.promises.stat(filePath);
            return { type: stat.isFile() ? "File" : "Directory", size: BigInt(stat.size) };
          },
          catch: (cause) => cause as Error,
        }),
      readFile: (filePath: string) =>
        Effect.tryPromise({
          try: () => fs.promises.readFile(filePath),
          catch: (cause) => cause as Error,
        }),
      writeFile: () =>
        Effect.sync(() => {
          writeCount += 1;
        }),
    } as unknown as FileSystem.FileSystem;
    const normalizer = makeDispatchCommandNormalizer<Error>({
      attachmentsDir,
      fileSystem,
      path: path as unknown as Path.Path,
      canonicalizeProjectWorkspaceRoot: (workspaceRoot) => Effect.succeed(workspaceRoot),
    });

    try {
      const result = await Effect.runPromise(
        normalizer({
          command: {
            type: "thread.turn.start",
            commandId: CommandId.makeUnsafe("cmd-turn-stream-ref"),
            threadId: ThreadId.makeUnsafe("thread-stream-ref"),
            message: {
              messageId: MessageId.makeUnsafe("msg-stream-ref"),
              role: "user",
              text: "summarize",
              attachments: [
                {
                  type: "file",
                  id,
                  name: "report.pdf",
                  mimeType: "application/pdf",
                  sizeBytes: bytes.byteLength,
                  contentHash,
                  uploadMethod: "stream",
                },
              ],
            },
            runtimeMode: "full-access",
            interactionMode: "default",
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        }),
      );

      expect(result.command).toMatchObject({
        message: {
          attachments: [
            {
              type: "file",
              id,
              name: "report.pdf",
              mimeType: "application/pdf",
              sizeBytes: bytes.byteLength,
              contentHash,
              uploadMethod: "stream",
            },
          ],
        },
      });
      expect(writeCount).toBe(0);
    } finally {
      fs.rmSync(attachmentsDir, { recursive: true, force: true });
    }
  });

  it("rejects a streaming reference when same-size bytes changed after upload", async () => {
    const attachmentsDir = fs.mkdtempSync(path.join(os.tmpdir(), "djl-dispatch-mutated-ref-"));
    const original = Buffer.from("%PDF-1.7\noriginal");
    const contentHash = createHash("sha256").update(original).digest("hex");
    const id = `thread-mutated-ref-${contentHash.slice(0, 8)}-${contentHash.slice(8, 12)}-${contentHash.slice(12, 16)}-${contentHash.slice(16, 20)}-${contentHash.slice(20, 32)}`;
    fs.writeFileSync(path.join(attachmentsDir, `${id}.pdf`), Buffer.from("%PDF-1.7\nmodified"));
    const fileSystem = {
      stat: (filePath: string) =>
        Effect.tryPromise({
          try: async () => {
            const stat = await fs.promises.stat(filePath);
            return { type: stat.isFile() ? "File" : "Directory", size: BigInt(stat.size) };
          },
          catch: (cause) => cause as Error,
        }),
      readFile: (filePath: string) =>
        Effect.tryPromise({
          try: () => fs.promises.readFile(filePath),
          catch: (cause) => cause as Error,
        }),
    } as unknown as FileSystem.FileSystem;
    const normalizer = makeDispatchCommandNormalizer<Error>({
      attachmentsDir,
      fileSystem,
      path: path as unknown as Path.Path,
      canonicalizeProjectWorkspaceRoot: (workspaceRoot) => Effect.succeed(workspaceRoot),
    });

    try {
      await expect(
        Effect.runPromise(
          normalizer({
            command: {
              type: "thread.turn.start",
              commandId: CommandId.makeUnsafe("cmd-mutated-ref"),
              threadId: ThreadId.makeUnsafe("thread-mutated-ref"),
              message: {
                messageId: MessageId.makeUnsafe("msg-mutated-ref"),
                role: "user",
                text: "summarize",
                attachments: [
                  {
                    type: "file",
                    id,
                    name: "report.pdf",
                    mimeType: "application/pdf",
                    sizeBytes: original.byteLength,
                    contentHash,
                    uploadMethod: "stream",
                  },
                ],
              },
              runtimeMode: "full-access",
              interactionMode: "default",
              createdAt: "2026-01-01T00:00:00.000Z",
            },
          }),
        ),
      ).rejects.toThrow("content hash");
    } finally {
      fs.rmSync(attachmentsDir, { recursive: true, force: true });
    }
  });

  it("rolls back attachment files written before a later upload fails", async () => {
    const attachmentsDir = fs.mkdtempSync(path.join(os.tmpdir(), "synara-dispatch-normalize-"));
    const fileSystem = {
      makeDirectory: (dir: string, options?: { readonly recursive?: boolean }) =>
        Effect.sync(() => {
          fs.mkdirSync(dir, { recursive: options?.recursive === true });
        }),
      writeFile: (filePath: string, bytes: Uint8Array) =>
        Effect.sync(() => {
          fs.writeFileSync(filePath, bytes);
        }),
      remove: (filePath: string, options?: { readonly force?: boolean }) =>
        Effect.sync(() => {
          fs.rmSync(filePath, { force: options?.force === true });
        }),
    } as unknown as FileSystem.FileSystem;
    const normalizer = makeDispatchCommandNormalizer<Error>({
      attachmentsDir,
      fileSystem,
      path: path as unknown as Path.Path,
      canonicalizeProjectWorkspaceRoot: (workspaceRoot) => Effect.succeed(workspaceRoot),
    });

    try {
      await expect(
        Effect.runPromise(
          normalizer({
            command: {
              type: "thread.turn.start",
              commandId: CommandId.makeUnsafe("cmd-turn-attachments"),
              threadId: ThreadId.makeUnsafe("thread-rollback-attachments"),
              message: {
                messageId: MessageId.makeUnsafe("msg-attachments"),
                role: "user",
                text: "send files",
                attachments: [
                  {
                    type: "image",
                    name: "ok.png",
                    mimeType: "image/png",
                    sizeBytes: 1,
                    dataUrl: "data:image/png;base64,AQ==",
                  },
                  {
                    type: "image",
                    name: "bad.png",
                    mimeType: "image/png",
                    sizeBytes: 1,
                    dataUrl: "data:text/plain;base64,AQ==",
                  },
                ],
              },
              runtimeMode: "full-access",
              interactionMode: "default",
              createdAt: "2026-01-01T00:00:00.000Z",
            } satisfies Extract<ClientOrchestrationCommand, { type: "thread.turn.start" }>,
          }),
        ),
      ).rejects.toThrow("Invalid image attachment payload");

      expect(fs.readdirSync(attachmentsDir)).toEqual([]);
    } finally {
      fs.rmSync(attachmentsDir, { recursive: true, force: true });
    }
  });
});
