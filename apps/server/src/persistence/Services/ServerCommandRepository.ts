import type { ServerCommandRecord, ServerId } from "@synara/contracts";
import { ServiceMap } from "effect";
import type { Effect } from "effect";

import type { ServerRepositoryError } from "../Errors.ts";

export interface ServerCommandRepositoryShape {
  readonly insert: (record: ServerCommandRecord) => Effect.Effect<void, ServerRepositoryError>;
  readonly update: (record: ServerCommandRecord) => Effect.Effect<void, ServerRepositoryError>;
  /** Newest first. Default limit 20. */
  readonly listByServer: (input: {
    readonly id: ServerId;
    readonly limit?: number;
  }) => Effect.Effect<ReadonlyArray<ServerCommandRecord>, ServerRepositoryError>;
  /** Commands awaiting approval, oldest first. */
  readonly listPending: () => Effect.Effect<
    ReadonlyArray<ServerCommandRecord>,
    ServerRepositoryError
  >;
}

export class ServerCommandRepository extends ServiceMap.Service<
  ServerCommandRepository,
  ServerCommandRepositoryShape
>()("synara/persistence/Services/ServerCommandRepository") {}
