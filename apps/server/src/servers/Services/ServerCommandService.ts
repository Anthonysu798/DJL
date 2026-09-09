// FILE: ServerCommandService.ts
// Purpose: Service tag for agent commands on registered servers (the `djl-ssh` shim):
//          tier enforcement, approval queue, execution and audit trail.
// Layer: Servers domain service
import type {
  ServerCommandRecord,
  ServerCommandStreamEvent,
  ServerListCommandsInput,
  ServerListCommandsResult,
  ServerResolveCommandInput,
} from "@synara/contracts";
import { Data, ServiceMap } from "effect";
import type { Effect, Stream } from "effect";

import type { SecretStoreError } from "../../auth/Services/ServerSecretStore";
import type { ServerRepositoryError } from "../../persistence/Errors.ts";
import type { SshRunnerError } from "../SshRunner";

export class ServerCommandNotPendingError extends Data.TaggedError("ServerCommandNotPendingError")<{
  readonly id: string;
}> {
  override get message(): string {
    return `Command ${this.id} is not waiting for approval.`;
  }
}

export type ServerCommandServiceError =
  | ServerRepositoryError
  | SecretStoreError
  | SshRunnerError
  | ServerCommandNotPendingError;

export interface ServerCommandRequest {
  readonly serverName: string;
  readonly threadId?: string;
  readonly command: string;
}

/** The finished record plus what the shim prints and exits with. */
export type ServerCommandOutcome = ServerCommandRecord & {
  readonly stdout: string;
  readonly exitCode: number;
};

export interface ServerCommandServiceShape {
  /** Resolves the server, enforces its tier, runs the command and records the result. */
  readonly requestCommand: (
    input: ServerCommandRequest,
  ) => Effect.Effect<ServerCommandOutcome, ServerCommandServiceError>;
  /** Approves or denies a command waiting in the approve-each queue. */
  readonly resolve: (
    input: ServerResolveCommandInput,
  ) => Effect.Effect<ServerCommandRecord, ServerCommandServiceError>;
  readonly listByServer: (
    input: ServerListCommandsInput,
  ) => Effect.Effect<ServerListCommandsResult, ServerCommandServiceError>;
  readonly listPending: () => Effect.Effect<
    ReadonlyArray<ServerCommandRecord>,
    ServerCommandServiceError
  >;
  readonly streamEvents: Stream.Stream<ServerCommandStreamEvent>;
}

export class ServerCommandService extends ServiceMap.Service<
  ServerCommandService,
  ServerCommandServiceShape
>()("synara/servers/Services/ServerCommandService") {}
