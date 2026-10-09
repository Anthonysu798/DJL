/**
 * Admission control for the gateway when an instance approaches its stream cap.
 *
 * Deterministic and side-effect free: given the current load and a request's
 * plan weight, decide admit / queue / reject. The API applies it per instance.
 */
export interface AdmissionInput {
  readonly inFlight: number;
  readonly softCap: number;
  readonly hardCap: number;
  readonly priorityWeight: number;
  readonly maxPriorityWeight: number;
}

export type AdmissionDecision = "admit" | "queue" | "reject";

export function decideAdmission(input: AdmissionInput): AdmissionDecision {
  if (input.inFlight >= input.hardCap)
    return input.priorityWeight >= input.maxPriorityWeight ? "queue" : "reject";
  if (input.inFlight < input.softCap) return "admit";
  // Between soft and hard cap: admit proportionally to weight. Top weight always admits.
  const headroom = input.hardCap - input.softCap;
  const used = input.inFlight - input.softCap;
  const share = input.priorityWeight / input.maxPriorityWeight; // 0..1
  return used < headroom * share ? "admit" : "queue";
}
