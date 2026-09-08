// FILE: ServerService.ts
// Purpose: Service tag for the Servers registry (CRUD, connection tests, stats, import).
// Layer: Servers domain service
import type {
  ServerByIdInput,
  ServerCapabilities,
  ServerConnectionTest,
  ServerCreateInput,
  ServerDeleteInput,
  ServerImportApplyInput,
  ServerImportApplyResult,
  ServerImportPreviewResult,
  ServerListLocalKeysResult,
  ServerListResult,
  ServerRecord,
  ServerRefreshStatsResult,
  ServerTrustHostKeyInput,
  ServerUpdateInput,
} from "@synara/contracts";
import { Data, ServiceMap } from "effect";
import type { Effect } from "effect";

import type { SecretStoreError } from "../../auth/Services/ServerSecretStore";
import type { ServerRepositoryError } from "../../persistence/Errors.ts";
import type { SshRunnerError } from "../SshRunner";

export class ServerNotFoundError extends Data.TaggedError("ServerNotFoundError")<{
  readonly id: string;
}> {
  override get message(): string {
    return `Server ${this.id} was not found.`;
  }
}

export type ServerServiceError =
  | ServerRepositoryError
  | SecretStoreError
  | SshRunnerError
  | ServerNotFoundError;

export interface ServerServiceShape {
  readonly list: () => Effect.Effect<ServerListResult, ServerServiceError>;
  readonly create: (input: ServerCreateInput) => Effect.Effect<ServerRecord, ServerServiceError>;
  readonly update: (input: ServerUpdateInput) => Effect.Effect<ServerRecord, ServerServiceError>;
  readonly remove: (input: ServerDeleteInput) => Effect.Effect<void, ServerServiceError>;
  readonly testConnection: (
    input: ServerByIdInput,
  ) => Effect.Effect<ServerConnectionTest, ServerServiceError>;
  readonly trustHostKey: (
    input: ServerTrustHostKeyInput,
  ) => Effect.Effect<ServerConnectionTest, ServerServiceError>;
  readonly refreshStats: (
    input: ServerByIdInput,
  ) => Effect.Effect<ServerRefreshStatsResult, ServerServiceError>;
  readonly importPreview: () => Effect.Effect<ServerImportPreviewResult, ServerServiceError>;
  readonly importApply: (
    input: ServerImportApplyInput,
  ) => Effect.Effect<ServerImportApplyResult, ServerServiceError>;
  readonly checkCapabilities: () => Effect.Effect<ServerCapabilities>;
  readonly listLocalKeys: () => Effect.Effect<ServerListLocalKeysResult>;
}

export class ServerService extends ServiceMap.Service<ServerService, ServerServiceShape>()(
  "synara/servers/Services/ServerService",
) {}
