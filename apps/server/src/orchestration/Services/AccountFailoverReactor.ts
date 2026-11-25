import { ServiceMap } from "effect";
import type { Effect, Scope } from "effect";

export interface AccountFailoverReactorShape {
  readonly start: Effect.Effect<void, never, Scope.Scope>;
  readonly drain: Effect.Effect<void>;
}

export class AccountFailoverReactor extends ServiceMap.Service<
  AccountFailoverReactor,
  AccountFailoverReactorShape
>()("djl/orchestration/Services/AccountFailoverReactor") {}
