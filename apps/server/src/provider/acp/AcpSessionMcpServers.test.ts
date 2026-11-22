// FILE: AcpSessionMcpServers.test.ts
// Purpose: Verifies an ACP session is set up with the tool servers its owner picks after the
//          agent's initialize reply.
// Layer: Provider ACP runtime tests

import * as path from "node:path";
import { fileURLToPath } from "node:url";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import { Effect } from "effect";
import type * as EffectAcpSchema from "effect-acp/schema";
import { describe, expect } from "vitest";

import { AcpSessionRuntime, type AcpSessionRequestLogEvent } from "./AcpSessionRuntime.ts";

const mockAgentPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../scripts/acp-mock-agent.ts",
);

describe("AcpSessionRuntime tool servers", () => {
  it.effect("sends the servers chosen from the initialize reply with session/new", () => {
    const requestEvents: Array<AcpSessionRequestLogEvent> = [];
    const seen: Array<EffectAcpSchema.InitializeResponse> = [];
    return Effect.gen(function* () {
      const runtime = yield* AcpSessionRuntime;
      yield* runtime.start();
      expect(seen).toHaveLength(1);
      expect(seen[0]?.protocolVersion).toBe(1);
      const created = requestEvents.find(
        (event) => event.method === "session/new" && event.status === "started",
      );
      expect(created?.payload).toMatchObject({
        mcpServers: [{ type: "http", name: "djl_linear", url: "http://127.0.0.1:5000/mcp/linear" }],
      });
    }).pipe(
      Effect.provide(
        AcpSessionRuntime.layer({
          spawn: { command: "bun", args: [mockAgentPath] },
          cwd: process.cwd(),
          clientInfo: { name: "djl-test", version: "0.0.0" },
          authMethodId: "test",
          mcpServers: (initializeResult) => {
            seen.push(initializeResult);
            return [
              {
                type: "http",
                name: "djl_linear",
                url: "http://127.0.0.1:5000/mcp/linear",
                headers: [],
              },
            ];
          },
          requestLogger: (event) => Effect.sync(() => void requestEvents.push(event)),
        }),
      ),
      Effect.scoped,
      Effect.provide(NodeServices.layer),
    );
  });
});
