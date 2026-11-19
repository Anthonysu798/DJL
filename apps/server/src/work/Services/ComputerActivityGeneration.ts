import { ServiceMap } from "effect";
import type { Effect } from "effect";
import type {
  ComputerActivityGenerationError,
  ComputerActivitySummaryGenerationInput,
  ComputerActivitySummaryGenerationResult,
} from "../computerActivitySummarization";

export interface ComputerActivityGenerationShape {
  readonly generate: (
    input: ComputerActivitySummaryGenerationInput,
  ) => Effect.Effect<ComputerActivitySummaryGenerationResult, ComputerActivityGenerationError>;
}

export class ComputerActivityGeneration extends ServiceMap.Service<
  ComputerActivityGeneration,
  ComputerActivityGenerationShape
>()("djl/work/Services/ComputerActivityGeneration") {}
