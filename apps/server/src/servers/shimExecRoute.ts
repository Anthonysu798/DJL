// FILE: shimExecRoute.ts
// Purpose: Transport-agnostic handler behind POST /api/servers/shim/exec, the endpoint the
//          `djl-ssh` helper calls. Authenticates with this process's shim token only.
// Layer: Servers HTTP adapter
import { timingSafeEqual } from "node:crypto";
import { Effect } from "effect";

import type {
  ServerCommandOutcome,
  ServerCommandRequest,
  ServerCommandServiceError,
} from "./Services/ServerCommandService";

export interface ShimExecRequest {
  readonly authorization: string | undefined;
  readonly serverName: string | undefined;
  readonly threadId: string | undefined;
  readonly body: string;
}

export interface ShimExecResponse {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly body: string;
}

/** BSD sysexits: the shim exits with this when DJL itself failed to run the command. */
const EXIT_SOFTWARE = 70;

function bearerTokenMatches(authorization: string | undefined, token: string): boolean {
  const presented = authorization?.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  const left = Buffer.from(presented, "utf8");
  const right = Buffer.from(token, "utf8");
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
}

const reply = (status: number, exitCode: number, commandStatus: string, body: string) =>
  ({
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-DJL-Exit-Code": String(exitCode),
      "X-DJL-Status": commandStatus,
    },
    body,
  }) satisfies ShimExecResponse;

export const handleShimExec = (
  input: ShimExecRequest,
  deps: {
    readonly token: string;
    readonly requestCommand: (
      request: ServerCommandRequest,
    ) => Effect.Effect<ServerCommandOutcome, ServerCommandServiceError>;
  },
): Effect.Effect<ShimExecResponse> =>
  Effect.gen(function* () {
    if (!bearerTokenMatches(input.authorization, deps.token)) {
      return reply(401, EXIT_SOFTWARE, "refused", "djl-ssh: unauthorized (shim token mismatch)\n");
    }
    const serverName = input.serverName?.trim() ?? "";
    if (serverName.length === 0) {
      return reply(400, EXIT_SOFTWARE, "refused", "djl-ssh: missing X-DJL-Server header\n");
    }
    const command = input.body.trim();
    if (command.length === 0) {
      return reply(400, EXIT_SOFTWARE, "refused", "djl-ssh: empty command\n");
    }
    const threadId = input.threadId?.trim();
    return yield* deps
      .requestCommand({ serverName, command, ...(threadId ? { threadId } : {}) })
      .pipe(
        Effect.map((outcome) => {
          const explain =
            outcome.status === "refused" ||
            outcome.status === "denied" ||
            outcome.status === "timed-out";
          const body = explain ? `djl-ssh: ${outcome.reason ?? outcome.status}\n` : outcome.stdout;
          return reply(200, outcome.exitCode, outcome.status, body);
        }),
        Effect.catch((error) =>
          Effect.succeed(reply(500, EXIT_SOFTWARE, "failed", `djl-ssh: ${error.message}\n`)),
        ),
      );
  });
