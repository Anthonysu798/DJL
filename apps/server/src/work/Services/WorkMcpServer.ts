// FILE: WorkMcpServer.ts
// Purpose: DJL-owned, session-scoped MCP endpoint contract for OpenCode Work tools.

import type { ProjectId, ThreadId } from "@synara/contracts";
import { Schema, ServiceMap } from "effect";
import type { Effect } from "effect";

export class WorkMcpServerError extends Schema.TaggedErrorClass<WorkMcpServerError>()(
  "WorkMcpServerError",
  {
    operation: Schema.String,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {
  override get message(): string {
    return `Work MCP ${this.operation} failed: ${this.detail}`;
  }
}

export interface WorkMcpSessionRegistration {
  readonly name: string;
  readonly url: string;
  readonly bearerToken: string;
}

export interface WorkMcpServerShape {
  readonly start: Effect.Effect<void, WorkMcpServerError>;
  readonly registerSession: (input: {
    readonly threadId: ThreadId;
    readonly projectId?: ProjectId;
    readonly authorizedRoot: string;
    readonly attachmentsRoot?: string;
  }) => Effect.Effect<WorkMcpSessionRegistration, WorkMcpServerError>;
  readonly unregisterSession: (bearerToken: string) => Effect.Effect<void, never>;
}

export class WorkMcpServer extends ServiceMap.Service<WorkMcpServer, WorkMcpServerShape>()(
  "synara/work/Services/WorkMcpServer",
) {}
