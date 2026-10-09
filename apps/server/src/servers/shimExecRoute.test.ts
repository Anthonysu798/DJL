import { ServerCommandId, ServerId, type ServerCommandRecord } from "@synara/contracts";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { SshRunnerError } from "./SshRunner";
import { handleShimExec, type ShimExecRequest } from "./shimExecRoute";
import type { ServerCommandOutcome, ServerCommandRequest } from "./Services/ServerCommandService";

const TOKEN = "a".repeat(64);

const record = (overrides: Partial<ServerCommandRecord> = {}): ServerCommandRecord => ({
  id: ServerCommandId.makeUnsafe("cmd-1"),
  serverId: ServerId.makeUnsafe("srv-1"),
  serverName: "hk-1",
  command: "uptime",
  tier: "full",
  status: "succeeded",
  exitCode: 0,
  output: "up 3 days\n",
  requestedAt: 1,
  finishedAt: 2,
  ...overrides,
});

const request = (overrides: Partial<ShimExecRequest> = {}): ShimExecRequest => ({
  authorization: `Bearer ${TOKEN}`,
  serverName: "hk-1",
  threadId: "thread-1",
  body: "uptime",
  ...overrides,
});

const handle = (
  input: ShimExecRequest,
  requestCommand: (
    input: ServerCommandRequest,
  ) => Effect.Effect<ServerCommandOutcome, SshRunnerError>,
) => Effect.runPromise(handleShimExec(input, { token: TOKEN, requestCommand }));

const never = () => {
  throw new Error("must not be called");
};

describe("handleShimExec", () => {
  it("returns the output with exit code and status headers", async () => {
    const calls: ServerCommandRequest[] = [];
    const response = await handle(request(), (input) => {
      calls.push(input);
      return Effect.succeed({ ...record(), stdout: "up 3 days\n", exitCode: 0 });
    });
    expect(response.status).toBe(200);
    expect(response.body).toBe("up 3 days\n");
    expect(response.headers["X-DJL-Exit-Code"]).toBe("0");
    expect(response.headers["X-DJL-Status"]).toBe("succeeded");
    expect(calls).toEqual([{ serverName: "hk-1", threadId: "thread-1", command: "uptime" }]);
  });

  it("prefixes refusals, denials and timeouts with djl-ssh:", async () => {
    for (const status of ["refused", "denied", "timed-out"] as const) {
      const response = await handle(request(), () =>
        Effect.succeed({
          ...record({ status, exitCode: 126, reason: "Not allowed here" }),
          stdout: "",
          exitCode: 126,
        }),
      );
      expect(response.status).toBe(200);
      expect(response.body).toBe("djl-ssh: Not allowed here\n");
      expect(response.headers["X-DJL-Exit-Code"]).toBe("126");
      expect(response.headers["X-DJL-Status"]).toBe(status);
    }
  });

  it("rejects a missing, malformed or wrong bearer token with 401", async () => {
    for (const authorization of [
      undefined,
      "Bearer",
      `Bearer ${"b".repeat(64)}`,
      `Bearer ${TOKEN}x`,
      TOKEN,
    ]) {
      const response = await handle(request({ authorization }), never);
      expect(response.status).toBe(401);
    }
  });

  it("rejects an empty command or missing server with 400", async () => {
    expect((await handle(request({ body: "  \n" }), never)).status).toBe(400);
    expect((await handle(request({ serverName: undefined }), never)).status).toBe(400);
    expect((await handle(request({ serverName: "" }), never)).status).toBe(400);
  });

  it("omits threadId when the header is blank", async () => {
    const calls: ServerCommandRequest[] = [];
    await handle(request({ threadId: "" }), (input) => {
      calls.push(input);
      return Effect.succeed({ ...record(), stdout: "", exitCode: 0 });
    });
    expect(calls[0]).toEqual({ serverName: "hk-1", command: "uptime" });
  });

  it("turns a service failure into a 500 with exit code 70", async () => {
    const response = await handle(request(), () =>
      Effect.fail(new SshRunnerError({ message: "Failed to start ssh." })),
    );
    expect(response.status).toBe(500);
    expect(response.body).toBe("djl-ssh: Failed to start ssh.\n");
    expect(response.headers["X-DJL-Exit-Code"]).toBe("70");
    expect(response.headers["X-DJL-Status"]).toBe("failed");
  });
});
