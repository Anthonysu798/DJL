import { ServiceMap } from "effect";
import type { Effect, Scope } from "effect";

export interface MemoryReactorShape {
  readonly start: Effect.Effect<void, never, Scope.Scope>;
  readonly drain: Effect.Effect<void>;
}

export class MemoryReactor extends ServiceMap.Service<MemoryReactor, MemoryReactorShape>()(
  "djl/orchestration/Services/MemoryReactor",
) {}
