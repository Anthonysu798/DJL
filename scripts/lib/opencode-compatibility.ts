// Observed model traffic and tool results, not version or HTTP-success heuristics.
export interface OpenCodeWorkObservation {
  readonly requestCount: number;
  readonly tools: ReadonlyArray<string>;
  readonly toolChoice: unknown;
  readonly inheritedInstructions: boolean;
  readonly recoveredToolCompleted: boolean;
}

export function evaluateOpenCodeWorkCompatibility(
  observation: OpenCodeWorkObservation,
  forceLocalToolChoice = true,
): Array<string> {
  const failures: Array<string> = [];
  if (observation.requestCount === 0) failures.push("model-request");
  if (observation.tools.length !== 1 || observation.tools[0] !== "read") {
    failures.push("tool-visibility");
  }
  if (forceLocalToolChoice && observation.toolChoice !== "required")
    failures.push("required-local-tool-choice");
  if (!forceLocalToolChoice && observation.toolChoice === "required")
    failures.push("remote-tool-choice-forced");
  if (observation.inheritedInstructions) failures.push("instruction-isolation");
  if (!observation.recoveredToolCompleted) failures.push("text-tool-call-recovery");
  return failures;
}
