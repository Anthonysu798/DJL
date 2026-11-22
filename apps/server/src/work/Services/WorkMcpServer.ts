// FILE: WorkMcpServer.ts
// Purpose: DJL-owned, session-scoped MCP endpoint contract for OpenCode Work tools.

import type { ProjectId, ThreadId, ComputerTurnControl, ProviderKind } from "@djl/contracts";
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
  readonly multipost?: {
    readonly name: string;
    readonly url: string;
    readonly bearerToken: string;
  };
  readonly name: string;
  readonly url: string;
  readonly bearerToken: string;
  readonly computer?: {
    begin: (
      control: ComputerTurnControl | undefined,
      activityHistory?: boolean,
    ) => Promise<string | undefined>;
    end: (expectedTurnId?: string) => Promise<void>;
    toolNames: () => readonly string[];
    requestHeaders: () => Readonly<Record<string, string>>;
  };
}

export interface WorkMcpServerShape {
  readonly start: Effect.Effect<void, WorkMcpServerError>;
  readonly registerSession: (input: {
    readonly threadId: ThreadId;
    readonly projectId?: ProjectId;
    readonly authorizedRoot: string;
    readonly provider?: ProviderKind;
    readonly publishComputerApproval?: NonNullable<
      ConstructorParameters<
        typeof import("../cuaComputerSession").CuaComputerSession
      >[0]["publishApproval"]
    >;
    readonly requestComputerApproval?: import("../cuaComputerSession").ComputerApprovalRequest;
    readonly attachmentsRoot?: string;
  }) => Effect.Effect<WorkMcpSessionRegistration, WorkMcpServerError>;
  readonly unregisterSession: (bearerToken: string) => Effect.Effect<void, never>;
}

export class WorkMcpServer extends ServiceMap.Service<WorkMcpServer, WorkMcpServerShape>()(
  "djl/work/Services/WorkMcpServer",
) {}
