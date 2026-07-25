// Integration test for the production /api/local-image Effect-based route.
// Boots the same `localImageEffectRouteLayer` that `makeEffectHttpRouteLayer` wires
// into `effectServer.ts` and exercises it through a real HTTP listener.
import http from "node:http";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { DateTime, Effect, Exit, Layer, Option, Scope } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { afterEach, describe, expect, it } from "vitest";

import { ServerAuth, type ServerAuthShape } from "./auth/Services/ServerAuth";
import {
  resolveDefaultChatWorkspaceRoot,
  resolveDefaultStudioWorkspaceRoot,
  ServerConfig,
  type ServerConfigShape,
} from "./config";
import {
  attachmentsEffectRouteLayer,
  documentPreviewEffectRouteLayer,
  localImageEffectRouteLayer,
  streamingAttachmentUploadEffectRouteLayer,
} from "./http";
import { createLocalPreviewGrant } from "./localImageFiles";
import {
  clearDocumentPreviewRegistryForTests,
  issueDocumentPreviewGrant,
  registerDocumentPreview,
} from "./work/documentPreviewFiles";
import {
  ProjectionSnapshotQuery,
  type ProjectionSnapshotQueryShape,
} from "./orchestration/Services/ProjectionSnapshotQuery";

const tempDirs: string[] = [];

afterEach(() => {
  clearDocumentPreviewRegistryForTests();
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function makeServerConfig(overrides: Partial<ServerConfigShape> = {}): ServerConfigShape {
  const baseDir = makeTempDir("synara-effect-route-");
  return {
    mode: "web",
    port: 0,
    host: undefined,
    cwd: baseDir,
    homeDir: os.homedir(),
    chatWorkspaceRoot: resolveDefaultChatWorkspaceRoot({ homeDir: os.homedir() }),
    studioWorkspaceRoot: resolveDefaultStudioWorkspaceRoot({ homeDir: os.homedir() }),
    baseDir,
    keybindingsConfigPath: path.join(baseDir, "keybindings.json"),
    serverRuntimeStatePath: path.join(baseDir, "runtime.json"),
    serverSettingsPath: path.join(baseDir, "settings.json"),
    attachmentsDir: path.join(baseDir, "attachments"),
    sqlitePath: path.join(baseDir, "state.sqlite"),
    staticDir: undefined,
    devUrl: undefined,
    noBrowser: true,
    authToken: undefined,
    autoBootstrapProjectFromCwd: false,
    logProviderEvents: false,
    logWebSocketEvents: false,
    ...overrides,
  } as ServerConfigShape;
}

function makeFakeServerAuth(): ServerAuthShape {
  const expiresAt = Effect.runSync(DateTime.now);
  const descriptor = {
    policy: "loopback-browser" as const,
    bootstrapMethods: ["one-time-token" as const],
    sessionMethods: ["browser-session-cookie" as const, "bearer-session-token" as const],
    sessionCookieName: "synara_session",
  };
  const session = {
    sessionId: "session-id" as never,
    subject: "owner",
    method: "browser-session-cookie" as const,
    role: "owner" as const,
    expiresAt,
  };
  return {
    getDescriptor: () => Effect.succeed(descriptor),
    getSessionState: () => Effect.succeed({ authenticated: false, auth: descriptor }),
    exchangeBootstrapCredential: () =>
      Effect.succeed({
        response: {
          authenticated: true,
          role: "client" as const,
          sessionMethod: "browser-session-cookie" as const,
          expiresAt,
        },
        sessionToken: "session-token",
      }),
    exchangeBootstrapCredentialForBearerSession: () =>
      Effect.succeed({
        authenticated: true,
        role: "client" as const,
        sessionMethod: "bearer-session-token" as const,
        expiresAt,
        sessionToken: "bearer-session-token",
      }),
    issuePairingCredential: () =>
      Effect.succeed({ id: "pairing-id", credential: "PAIRINGTOKEN", expiresAt }),
    listPairingLinks: () => Effect.succeed([]),
    revokePairingLink: () => Effect.succeed(true),
    listClientSessions: () => Effect.succeed([]),
    revokeClientSession: () => Effect.succeed(true),
    revokeOtherClientSessions: () => Effect.succeed(1),
    authenticateHttpRequest: () => Effect.succeed(session),
    authenticateWebSocketUpgrade: () => Effect.succeed(session),
    issueWebSocketToken: () => Effect.succeed({ token: "ws-token", expiresAt }),
    issueStartupPairingUrl: () => Effect.succeed("http://127.0.0.1:3773/pair#token=PAIRINGTOKEN"),
  } satisfies ServerAuthShape;
}

async function withEffectServer(
  config: ServerConfigShape,
  routeLayer:
    | typeof localImageEffectRouteLayer
    | typeof attachmentsEffectRouteLayer
    | typeof streamingAttachmentUploadEffectRouteLayer
    | typeof documentPreviewEffectRouteLayer,
  run: (origin: string) => Promise<void>,
): Promise<void> {
  const scope = await Effect.runPromise(Scope.make("sequential"));
  let nodeServer: http.Server | null = null;
  try {
    await Effect.runPromise(
      Scope.provide(
        Effect.gen(function* () {
          const httpServer = yield* NodeHttpServer.make(
            () => {
              nodeServer = http.createServer();
              return nodeServer;
            },
            { port: 0, host: "127.0.0.1" },
          );
          const httpApp = yield* HttpRouter.toHttpEffect(routeLayer);
          yield* httpServer.serve(httpApp);
        }).pipe(
          Effect.provide(
            Layer.mergeAll(
              Layer.succeed(ServerConfig, config),
              Layer.succeed(ServerAuth, makeFakeServerAuth()),
              Layer.succeed(ProjectionSnapshotQuery, {
                getThreadShellById: (
                  threadId: Parameters<ProjectionSnapshotQueryShape["getThreadShellById"]>[0],
                ) =>
                  Effect.succeed(
                    threadId === "thread-1"
                      ? Option.some({ id: threadId, projectId: "project-1" } as never)
                      : Option.none(),
                  ),
              } as unknown as ProjectionSnapshotQueryShape),
              NodeServices.layer,
            ),
          ),
        ),
        scope,
      ),
    );
    const address = (nodeServer as http.Server | null)?.address();
    if (!address || typeof address !== "object") {
      throw new Error("Expected effect server to expose an address");
    }
    const origin = `http://127.0.0.1:${address.port}`;
    await run(origin);
  } finally {
    await Effect.runPromise(Scope.close(scope, Exit.void));
  }
}

describe("localImageEffectRouteLayer", () => {
  it("serves an allowlisted workspace image and signals downloads via Content-Disposition", async () => {
    const workspace = makeTempDir("synara-effect-image-workspace-");
    writeFileSync(path.join(workspace, ".git"), "gitdir: .git");
    const imagePath = path.join(workspace, "hero.png");
    writeFileSync(imagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const config = makeServerConfig({ cwd: workspace });

    await withEffectServer(config, localImageEffectRouteLayer, async (origin) => {
      const params = new URLSearchParams({ path: imagePath, cwd: workspace });
      const previewResponse = await fetch(`${origin}/api/local-image?${params}`);
      expect(previewResponse.status).toBe(200);
      expect(previewResponse.headers.get("content-type")).toContain("image/png");
      expect(previewResponse.headers.get("content-disposition")).toBeNull();

      params.set("download", "1");
      const downloadResponse = await fetch(`${origin}/api/local-image?${params}`);
      expect(downloadResponse.status).toBe(200);
      expect(downloadResponse.headers.get("content-disposition")).toContain("hero.png");
    });
  });

  it("serves an absolute local file outside the workspace for file-panel previews", async () => {
    const workspace = makeTempDir("synara-effect-image-workspace-");
    writeFileSync(path.join(workspace, ".git"), "gitdir: .git");
    const externalRoot = path.join(
      process.cwd(),
      `.test-local-preview-${process.pid}-${Date.now()}`,
    );
    tempDirs.push(externalRoot);
    mkdirSync(externalRoot, { recursive: true });
    // Use a PDF so the ungranted request cannot be admitted by the separate
    // temporary-image allowlist when this checkout itself lives under /tmp.
    const previewPath = path.join(externalRoot, "downloads-file.pdf");
    writeFileSync(previewPath, Buffer.from("%PDF-1.4"));
    const config = makeServerConfig({ cwd: workspace });

    const grant = await createLocalPreviewGrant({ requestedPath: previewPath });

    await withEffectServer(config, localImageEffectRouteLayer, async (origin) => {
      const params = new URLSearchParams({ path: previewPath, cwd: workspace, grant: grant.grant });
      const response = await fetch(`${origin}/api/local-image?${params}`);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("application/pdf");

      params.delete("grant");
      const ungrantedResponse = await fetch(`${origin}/api/local-image?${params}`);
      expect(ungrantedResponse.status).toBe(404);
    });
  });

  it("serves an allowlisted workspace PDF and only allows the desktop app origin to read it", async () => {
    const workspace = makeTempDir("synara-effect-pdf-workspace-");
    writeFileSync(path.join(workspace, ".git"), "gitdir: .git");
    const pdfPath = path.join(workspace, "spec.pdf");
    writeFileSync(pdfPath, Buffer.from("%PDF-1.4"));
    const config = makeServerConfig({ cwd: workspace });

    await withEffectServer(config, localImageEffectRouteLayer, async (origin) => {
      const params = new URLSearchParams({ path: pdfPath, cwd: workspace });
      const response = await fetch(`${origin}/api/local-image?${params}`, {
        headers: { Origin: "synara://app" },
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("application/pdf");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      // The in-app viewer fetches bytes cross-origin, but only trusted app
      // origins should get a CORS-readable response.
      expect(response.headers.get("access-control-allow-origin")).toBe("synara://app");
      expect(response.headers.get("vary")).toBe("Origin");
      // Streamed responses must still advertise their size so the browser's
      // PDF viewer can show load progress.
      expect(response.headers.get("content-length")).toBe("8");
      await expect(response.arrayBuffer()).resolves.toHaveProperty("byteLength", 8);
      // No Content-Disposition: the browser must render the PDF inline in the
      // preview iframe rather than trigger a download.
      expect(response.headers.get("content-disposition")).toBeNull();
    });
  });

  it("allows the configured Vite dev origin to read PDF bytes", async () => {
    const workspace = makeTempDir("synara-effect-pdf-dev-origin-");
    writeFileSync(path.join(workspace, ".git"), "gitdir: .git");
    const pdfPath = path.join(workspace, "spec.pdf");
    writeFileSync(pdfPath, Buffer.from("%PDF-1.4"));
    const config = makeServerConfig({
      cwd: workspace,
      devUrl: new URL("http://localhost:5173/"),
    });

    await withEffectServer(config, localImageEffectRouteLayer, async (origin) => {
      const params = new URLSearchParams({ path: pdfPath, cwd: workspace });
      const response = await fetch(`${origin}/api/local-image?${params}`, {
        headers: { Origin: "http://localhost:5173" },
      });

      expect(response.status).toBe(200);
      expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
    });
  });

  it("does not expose local preview bytes to untrusted web origins through CORS", async () => {
    const workspace = makeTempDir("synara-effect-pdf-untrusted-origin-");
    writeFileSync(path.join(workspace, ".git"), "gitdir: .git");
    const pdfPath = path.join(workspace, "spec.pdf");
    writeFileSync(pdfPath, Buffer.from("%PDF-1.4"));
    const config = makeServerConfig({ cwd: workspace });

    await withEffectServer(config, localImageEffectRouteLayer, async (origin) => {
      const params = new URLSearchParams({ path: pdfPath, cwd: workspace });
      const response = await fetch(`${origin}/api/local-image?${params}`, {
        headers: { Origin: "https://example.test" },
      });

      expect(response.status).toBe(200);
      expect(response.headers.get("access-control-allow-origin")).toBeNull();
      expect(response.headers.get("vary")).toBeNull();
    });
  });

  it("returns 404 when the requested path has an unsupported extension", async () => {
    const workspace = makeTempDir("synara-effect-image-bad-ext-");
    writeFileSync(path.join(workspace, ".git"), "gitdir: .git");
    const docPath = path.join(workspace, "notes.txt");
    writeFileSync(docPath, "hello");
    const config = makeServerConfig({ cwd: workspace });

    await withEffectServer(config, localImageEffectRouteLayer, async (origin) => {
      const params = new URLSearchParams({ path: docPath, cwd: workspace });
      const response = await fetch(`${origin}/api/local-image?${params}`);
      expect(response.status).toBe(404);
    });
  });

  it("returns 404 for missing files", async () => {
    const workspace = makeTempDir("synara-effect-image-missing-");
    writeFileSync(path.join(workspace, ".git"), "gitdir: .git");
    const ghostPath = path.join(workspace, "does-not-exist.png");
    const config = makeServerConfig({ cwd: workspace });

    await withEffectServer(config, localImageEffectRouteLayer, async (origin) => {
      const params = new URLSearchParams({ path: ghostPath, cwd: workspace });
      const response = await fetch(`${origin}/api/local-image?${params}`);
      expect(response.status).toBe(404);
    });
  });
});

describe("documentPreviewEffectRouteLayer", () => {
  it("serves a granted private PDF and supports byte ranges without exposing its path", async () => {
    const root = makeTempDir("djl-document-preview-");
    const previewPath = path.join(root, "rendered.pdf");
    const bytes = Buffer.from("%PDF-1.7\nDJL native preview\n%%EOF", "utf8");
    writeFileSync(previewPath, bytes);
    await registerDocumentPreview("render-1", previewPath);
    const issued = issueDocumentPreviewGrant("render-1");

    await withEffectServer(makeServerConfig(), documentPreviewEffectRouteLayer, async (origin) => {
      const url = `${origin}/api/work/document-previews/render-1?grant=${issued.grant}`;
      const response = await fetch(url);
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(response.headers.get("accept-ranges")).toBe("bytes");
      expect(await response.text()).toContain("DJL native preview");

      const range = await fetch(url, { headers: { Range: "bytes=0-7" } });
      expect(range.status).toBe(206);
      expect(range.headers.get("content-range")).toBe(`bytes 0-7/${bytes.byteLength}`);
      expect(Buffer.from(await range.arrayBuffer()).toString("utf8")).toBe("%PDF-1.7");
      expect(url).not.toContain(encodeURIComponent(previewPath));
    });
  });

  it("rejects missing, expired, and malformed preview grants", async () => {
    const root = makeTempDir("djl-document-preview-");
    const previewPath = path.join(root, "rendered.pdf");
    writeFileSync(previewPath, "%PDF-1.7\n%%EOF");
    await registerDocumentPreview("render-1", previewPath);
    const expired = issueDocumentPreviewGrant("render-1", { now: 1, ttlMs: 1 });

    await withEffectServer(makeServerConfig(), documentPreviewEffectRouteLayer, async (origin) => {
      expect(
        (await fetch(`${origin}/api/work/document-previews/render-1?grant=missing`)).status,
      ).toBe(404);
      expect(
        (await fetch(`${origin}/api/work/document-previews/render-1?grant=${expired.grant}`))
          .status,
      ).toBe(404);
      expect((await fetch(`${origin}/api/work/document-previews/..%2Fsecret?grant=x`)).status).toBe(
        404,
      );
    });
  });
});

describe("attachmentsEffectRouteLayer", () => {
  it("serves persisted image attachments by id without the file response helper", async () => {
    const config = makeServerConfig({ authToken: "desktop-secret" });
    mkdirSync(config.attachmentsDir, { recursive: true });
    writeFileSync(
      path.join(config.attachmentsDir, "thread-1-6ec544e7-9130-4a8b-993d-9635297d04d3.png"),
      Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    );

    await withEffectServer(config, attachmentsEffectRouteLayer, async (origin) => {
      const response = await fetch(
        `${origin}/attachments/thread-1-6ec544e7-9130-4a8b-993d-9635297d04d3?token=desktop-secret`,
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("image/png");
      expect(response.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
      await expect(response.arrayBuffer()).resolves.toHaveProperty("byteLength", 4);
    });
  });
});

describe("streamingAttachmentUploadEffectRouteLayer", () => {
  it("streams an authenticated Office attachment into an immutable reference", async () => {
    const config = makeServerConfig({ authToken: "desktop-secret" });
    const docxBytes = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      Buffer.from("test-docx"),
    ]);

    await withEffectServer(config, streamingAttachmentUploadEffectRouteLayer, async (origin) => {
      const params = new URLSearchParams({
        token: "desktop-secret",
        threadId: "thread-1",
        name: "proposal.docx",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        sizeBytes: String(docxBytes.byteLength),
      });
      const response = await fetch(`${origin}/api/attachments/upload?${params}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
          Origin: "synara://app",
        },
        body: docxBytes,
      });

      expect(response.status).toBe(201);
      expect(response.headers.get("access-control-allow-origin")).toBe("synara://app");
      const reference = (await response.json()) as {
        id: string;
        contentHash: string;
        uploadMethod: string;
      };
      expect(reference.uploadMethod).toBe("stream");
      expect(reference.contentHash).toMatch(/^[a-f0-9]{64}$/);
      expect(existsSync(path.join(config.attachmentsDir, `${reference.id}.docx`))).toBe(true);
    });
  });

  it("rejects unknown tasks before consuming an upload", async () => {
    const config = makeServerConfig({ authToken: "desktop-secret" });
    const bytes = Buffer.from("%PDF-1.7");

    await withEffectServer(config, streamingAttachmentUploadEffectRouteLayer, async (origin) => {
      const params = new URLSearchParams({
        token: "desktop-secret",
        threadId: "missing-thread",
        name: "report.pdf",
        mimeType: "application/pdf",
        sizeBytes: String(bytes.byteLength),
      });
      const response = await fetch(`${origin}/api/attachments/upload?${params}`, {
        method: "POST",
        body: bytes,
      });

      expect(response.status).toBe(404);
      expect(existsSync(config.attachmentsDir)).toBe(false);
    });
  });
});
