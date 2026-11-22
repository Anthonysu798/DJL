import { ComputerService } from "../../computer/Services/ComputerService";
import { ComputerManager } from "../../computer/ComputerManager";
import { FakeComputerBackend } from "../../computer/FakeComputerBackend";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { ProjectId, ThreadId } from "@djl/contracts";
import { Effect, Exit, ManagedRuntime, Scope, Layer } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WorkMcpServer } from "../Services/WorkMcpServer.ts";
import { attachmentIdForContentHash } from "../../streamingAttachmentUpload.ts";
import { WorkMcpServerLive } from "./WorkMcpServer.ts";

const roots: string[] = [];

function makeRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), "djl-work-mcp-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

async function rpc(
  registration: { url: string; bearerToken: string },
  body: Record<string, unknown>,
  token = registration.bearerToken,
  extraHeaders: Readonly<Record<string, string>> = {},
) {
  return fetch(registration.url, {
    method: "POST",
    headers: {
      ...extraHeaders,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify(body),
  });
}

describe("WorkMcpServer", () => {
  it("authenticates sessions and exposes scoped Office tools over Streamable HTTP", async () => {
    const runtime = ManagedRuntime.make(WorkMcpServerLive);
    const scope = await Effect.runPromise(Scope.make("sequential"));
    try {
      const server = await runtime.runPromise(Effect.service(WorkMcpServer));
      await Effect.runPromise(server.start.pipe(Scope.provide(scope)));
      const firstRoot = makeRoot();
      const secondRoot = makeRoot();
      const attachmentsRoot = makeRoot();
      const firstAttachmentBytes = Buffer.from("First task attachment");
      const firstAttachmentHash = createHash("sha256").update(firstAttachmentBytes).digest("hex");
      const firstAttachmentId = attachmentIdForContentHash("thread-1", firstAttachmentHash);
      const firstAttachmentPath = path.join(attachmentsRoot, `${firstAttachmentId}.txt`);
      writeFileSync(firstAttachmentPath, firstAttachmentBytes);
      const first = await runtime.runPromise(
        server.registerSession({
          threadId: ThreadId.makeUnsafe("thread-1"),
          projectId: ProjectId.makeUnsafe("project-1"),
          authorizedRoot: firstRoot,
          attachmentsRoot,
        }),
      );
      const second = await runtime.runPromise(
        server.registerSession({
          threadId: ThreadId.makeUnsafe("thread-2"),
          projectId: ProjectId.makeUnsafe("project-2"),
          authorizedRoot: secondRoot,
          attachmentsRoot,
        }),
      );

      const unauthorized = await rpc(
        first,
        {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/list",
        },
        "wrong-token",
      );
      expect(unauthorized.status).toBe(401);

      const initialized = await rpc(first, {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-03-26" },
      });
      expect(initialized.status).toBe(200);
      await expect(initialized.json()).resolves.toMatchObject({
        result: {
          protocolVersion: "2025-03-26",
          capabilities: { tools: { listChanged: false } },
        },
      });

      const optionalEventStream = await fetch(first.url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${first.bearerToken}`,
          Accept: "text/event-stream",
        },
      });
      expect(optionalEventStream.status).toBe(405);

      const listed = await rpc(first, { jsonrpc: "2.0", id: 2, method: "tools/list" });
      const listedBody = (await listed.json()) as {
        result: {
          tools: Array<{
            name: string;
            inputSchema: { type?: string };
            _meta: { "djl/tool-classification": string };
          }>;
        };
      };
      for (const tool of listedBody.result.tools) {
        expect(tool.inputSchema.type).toBe("object");
      }
      expect(listedBody.result.tools.map((tool) => tool.name)).toContain("djl_create_document");
      expect(listedBody.result.tools.map((tool) => tool.name)).toContain("djl_system_info");
      expect(listedBody.result.tools.map((tool) => tool.name)).toContain("djl_modify_office_copy");
      expect(listedBody.result.tools.map((tool) => tool.name)).toContain("djl_compare_pdfs");
      expect(
        listedBody.result.tools.find((tool) => tool.name === "djl_modify_office_copy")?._meta[
          "djl/tool-classification"
        ],
      ).toBe("modify-copy");

      const systemInfo = await rpc(first, {
        jsonrpc: "2.0",
        id: 29,
        method: "tools/call",
        params: { name: "djl_system_info", arguments: {} },
      });
      await expect(systemInfo.json()).resolves.toMatchObject({
        result: {
          isError: false,
          structuredContent: {
            os: { platform: expect.any(String), release: expect.any(String) },
            memory: { totalBytes: expect.any(Number), totalGiB: expect.any(Number) },
            cpu: { model: expect.any(String), logicalCores: expect.any(Number) },
            disk: {
              freeBytes: expect.any(Number),
              freeGiB: expect.any(Number),
              totalBytes: expect.any(Number),
              totalGiB: expect.any(Number),
            },
            collectedAt: expect.any(String),
          },
        },
      });

      const created = await rpc(first, {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "djl_create_document",
          arguments: {
            format: "pdf",
            name: "mcp-report",
            title: "MCP Report",
            paragraphs: ["Created through the scoped tool server."],
          },
        },
      });
      const createdBody = (await created.json()) as {
        result: { isError: boolean; structuredContent: { path: string } };
      };
      expect(createdBody.result.isError).toBe(false);
      expect(createdBody.result.structuredContent.path).toMatch(/^Deliverables\//);
      expect(JSON.stringify(createdBody)).not.toContain(realpathSync(firstRoot));
      expect(
        readFileSync(path.join(firstRoot, createdBody.result.structuredContent.path))
          .subarray(0, 4)
          .toString(),
      ).toBe("%PDF");

      const prefixedDocumentRead = await rpc(first, {
        jsonrpc: "2.0",
        id: 301,
        method: "tools/call",
        params: {
          name: "djl_read_document",
          arguments: { path: `Read ${createdBody.result.structuredContent.path}` },
        },
      });
      await expect(prefixedDocumentRead.json()).resolves.toMatchObject({
        result: {
          isError: false,
          structuredContent: {
            blocks: [expect.objectContaining({ text: expect.stringContaining("MCP Report") })],
          },
        },
      });

      const createdWithoutName = await rpc(first, {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: {
          name: "djl_create_document",
          arguments: {
            format: "docx",
            title: "Small model report.docx",
            paragraphs: ["The filename was derived safely."],
          },
        },
      });
      await expect(createdWithoutName.json()).resolves.toMatchObject({
        result: {
          isError: false,
          structuredContent: {
            path: expect.stringMatching(/^Deliverables\/.+\.docx$/),
          },
        },
      });

      const readOwnAttachment = await rpc(first, {
        jsonrpc: "2.0",
        id: 30,
        method: "tools/call",
        params: {
          name: "djl_read_document",
          arguments: { path: firstAttachmentPath },
        },
      });
      await expect(readOwnAttachment.json()).resolves.toMatchObject({
        result: {
          isError: false,
          structuredContent: {
            blocks: [expect.objectContaining({ text: "First task attachment" })],
          },
        },
      });

      const createdDocx = await rpc(first, {
        jsonrpc: "2.0",
        id: 31,
        method: "tools/call",
        params: {
          name: "djl_create_document",
          arguments: {
            format: "docx",
            name: "client-brief",
            title: "Client brief",
            paragraphs: ["Send on Monday."],
          },
        },
      });
      const createdDocxBody = (await createdDocx.json()) as {
        result: { isError: boolean; structuredContent: { path: string } };
      };
      const modifiedDocx = await rpc(first, {
        jsonrpc: "2.0",
        id: 32,
        method: "tools/call",
        params: {
          name: "djl_modify_office_copy",
          arguments: {
            inputPath: createdDocxBody.result.structuredContent.path,
            name: "client-brief",
            replacements: [{ find: "Monday", replace: "Friday" }],
          },
        },
      });
      await expect(modifiedDocx.json()).resolves.toMatchObject({
        result: {
          isError: false,
          structuredContent: { format: "docx", replacementsApplied: 1 },
        },
      });

      const isolation = await rpc(second, {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: {
          name: "djl_read_document",
          arguments: { path: createdBody.result.structuredContent.path },
        },
      });
      await expect(isolation.json()).resolves.toMatchObject({
        result: { isError: true },
      });
      const attachmentIsolation = await rpc(second, {
        jsonrpc: "2.0",
        id: 41,
        method: "tools/call",
        params: {
          name: "djl_read_document",
          arguments: { path: firstAttachmentPath },
        },
      });
      await expect(attachmentIsolation.json()).resolves.toMatchObject({
        result: { isError: true },
      });

      await runtime.runPromise(server.unregisterSession(first.bearerToken));
      expect((await rpc(first, { jsonrpc: "2.0", id: 5, method: "ping" })).status).toBe(401);
    } finally {
      await Effect.runPromise(Scope.close(scope, Exit.void));
      await runtime.dispose();
    }
  });
});

it("exposes the replacement catalog only to its admitted MCP turn and refuses legacy fallback", async () => {
  vi.stubEnv("DJL_COMPUTER_ENGINE", "cua");
  const manager = new ComputerManager({ backend: new FakeComputerBackend() });
  const runtime = ManagedRuntime.make(
    WorkMcpServerLive.pipe(
      Layer.provide(
        Layer.succeed(ComputerService, {
          supported: true,
          availability: { kind: "available", backend: "fake" },
          manager,
        }),
      ),
    ),
  );
  try {
    const server = await runtime.runPromise(Effect.service(WorkMcpServer));
    const first = await runtime.runPromise(
      server.registerSession({
        threadId: ThreadId.makeUnsafe("cua-first"),
        authorizedRoot: makeRoot(),
      }),
    );
    const second = await runtime.runPromise(
      server.registerSession({
        threadId: ThreadId.makeUnsafe("cua-second"),
        authorizedRoot: makeRoot(),
      }),
    );
    const names = async (registration: typeof first) => {
      const body = (await (
        await rpc(
          registration,
          { jsonrpc: "2.0", id: 1, method: "tools/list" },
          registration.bearerToken,
          registration.computer?.requestHeaders() ?? {},
        )
      ).json()) as { result: { tools: { name: string }[] } };
      return body.result.tools.map((tool) => tool.name);
    };
    expect((await names(first)).some((name) => name.startsWith("computer_"))).toBe(false);
    const firstComputerTurn = await first.computer!.begin({
      mode: "request",
      generation: 0,
      explicitInvocation: true,
    });
    expect(await names(first)).toContain("computer_get_state");
    expect(await names(first)).not.toContain("djl_computer_action");
    expect((await names(second)).some((name) => name.startsWith("computer_"))).toBe(false);
    const legacy = await rpc(first, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "djl_computer_open",
        arguments: { target: { bundleId: "dev.djl.fixture", pid: 123, windowId: 12 } },
      },
    });
    expect(await legacy.json()).toMatchObject({ result: { isError: true } });
    await first.computer!.begin({ mode: "request", generation: 0, explicitInvocation: true });
    const lateOldTurn = await rpc(
      first,
      {
        jsonrpc: "2.0",
        id: 31,
        method: "tools/call",
        params: { name: "computer_list_windows", arguments: {} },
      },
      first.bearerToken,
      { "x-djl-computer-turn": firstComputerTurn! },
    );
    expect(await lateOldTurn.json()).toMatchObject({ result: { isError: true } });
    await manager.setControlEnabled("cua-first", false);
    const stopped = await rpc(first, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "computer_list_windows", arguments: {} },
    });
    expect(await stopped.json()).toMatchObject({ result: { isError: true } });
    await first.computer!.begin({ mode: "request", generation: 0, explicitInvocation: true });
    expect((await names(first)).some((name) => name.startsWith("computer_"))).toBe(false);
  } finally {
    await runtime.dispose();
    await manager.dispose();
    vi.unstubAllEnvs();
  }
});
