import * as childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertOpenCodeServerCompatibility,
  inspectInstalledOpenCodeProtocol,
  OpenCodeProtocolError,
  validateOpenCodeProtocol,
} from "./openCodeInstalledProtocol";

vi.mock("node:child_process", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:child_process")>();
  return { ...original, spawn: vi.fn(original.spawn) };
});

function document() {
  return {
    openapi: "3.1.0",
    paths: Object.fromEntries(
      [
        ["/session", ["permission"]],
        ["/session/{sessionID}/message", ["parts", "model"]],
        ["/session/{sessionID}/prompt_async", ["parts", "model"]],
        ["/permission/{requestID}/reply", ["reply"]],
      ].map(([path, fields]) => [
        path,
        {
          post: {
            requestBody: {
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: Object.fromEntries(
                      (fields as string[]).map((name) => [
                        name,
                        {
                          type: name === "model" ? "object" : name === "reply" ? "string" : "array",
                        },
                      ]),
                    ),
                  },
                },
              },
            },
            responses: { "200": {} },
          },
        },
      ]),
    ),
  };
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
describe("installed OpenCode protocol", () => {
  it.skipIf(process.platform === "win32")(
    "times out an unresponsive CLI and terminates its process",
    async () => {
      vi.useFakeTimers();
      const child = Object.assign(new EventEmitter(), {
        stdout: new EventEmitter(),
        stderr: new EventEmitter(),
        pid: 123,
        exitCode: null,
        kill: vi.fn(() => {
          queueMicrotask(() => child.emit("exit", 0));
          return true;
        }),
      });
      const spawn = vi
        .mocked(childProcess.spawn)
        .mockReturnValue(child as unknown as childProcess.ChildProcessWithoutNullStreams);
      const result = inspectInstalledOpenCodeProtocol(process.execPath, "1.18.29-timeout-fixture");
      await vi.waitFor(() => expect(spawn).toHaveBeenCalled());
      await vi.advanceTimersByTimeAsync(15_001);
      await expect(result).resolves.toMatchObject({
        compatible: false,
        compatibilityMessage: expect.stringContaining("timed out"),
      });
      expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    },
  );

  it.each(["1.17.18", "1.18.29"])("accepts supported CLI %s and endpoint schemas", (version) => {
    expect(() => validateOpenCodeProtocol(document(), version)).not.toThrow();
  });
  it.each(["2.0.0", "unknown", undefined])("rejects unsupported version %s", (version) => {
    expect(() => validateOpenCodeProtocol(document(), version)).toThrow(OpenCodeProtocolError);
  });
  it("rejects missing endpoints and malformed request schemas", () => {
    const doc = document();
    delete doc.paths["/permission/{requestID}/reply"];
    expect(() => validateOpenCodeProtocol(doc, "1.18.29")).toThrow("incompatible");
    expect(() => validateOpenCodeProtocol({ openapi: "3.1.0", paths: {} }, "1.18.29")).toThrow(
      "incompatible",
    );
  });
  it("validates server health and doc without sending a model prompt", async () => {
    const fetch = vi.fn(async (url: URL) =>
      Response.json(url.pathname === "/doc" ? document() : { version: "1.18.29" }),
    );
    vi.stubGlobal("fetch", fetch);
    await assertOpenCodeServerCompatibility("http://127.0.0.1:5000", "secret-fixture");
    expect(fetch.mock.calls.map(([url]) => url.pathname).toSorted()).toEqual([
      "/doc",
      "/global/health",
    ]);
  });
  it("reports timeouts without leaking response or credential details", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new DOMException("secret credential", "TimeoutError")),
    );
    await expect(
      assertOpenCodeServerCompatibility("http://127.0.0.1:5000", "secret"),
    ).rejects.toMatchObject({ code: "timeout" });
  });
  it("sanitizes malformed server JSON errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("secret credential")),
    );
    await expect(assertOpenCodeServerCompatibility("http://127.0.0.1:5000")).rejects.toMatchObject({
      code: "incompatible",
    });
  });
});
