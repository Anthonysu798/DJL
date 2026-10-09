import type { ServerCreateInput, ServerId, ServerRecord } from "@synara/contracts";
import { ServiceMap } from "effect";
import type { Effect, Option } from "effect";

import type { ServerRepositoryError } from "../Errors.ts";

export interface CreateServerRecordInput {
  readonly id: ServerId;
  readonly input: ServerCreateInput;
  readonly now: number;
}

export interface ServerRepositoryShape {
  readonly list: () => Effect.Effect<ReadonlyArray<ServerRecord>, ServerRepositoryError>;
  readonly getById: (
    id: ServerId,
  ) => Effect.Effect<Option.Option<ServerRecord>, ServerRepositoryError>;
  readonly create: (
    input: CreateServerRecordInput,
  ) => Effect.Effect<ServerRecord, ServerRepositoryError>;
  readonly save: (record: ServerRecord) => Effect.Effect<ServerRecord, ServerRepositoryError>;
  readonly remove: (id: ServerId) => Effect.Effect<void, ServerRepositoryError>;
}

export class ServerRepository extends ServiceMap.Service<ServerRepository, ServerRepositoryShape>()(
  "synara/persistence/Services/ServerRepository",
) {}
