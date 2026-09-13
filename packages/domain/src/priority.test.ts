import { describe, expect, it } from "vitest";

import { decideAdmission } from "./priority.ts";

describe("admission", () => {
  const base = { softCap: 150, hardCap: 200, maxPriorityWeight: 16 };
  it("admits everyone below the soft cap", () => {
    expect(decideAdmission({ ...base, inFlight: 10, priorityWeight: 1 })).toBe("admit");
  });
  it("prefers heavier weights between soft and hard cap", () => {
    expect(decideAdmission({ ...base, inFlight: 190, priorityWeight: 16 })).toBe("admit");
    expect(decideAdmission({ ...base, inFlight: 190, priorityWeight: 1 })).toBe("queue");
  });
  it("at the hard cap, only top priority queues and the rest are rejected", () => {
    expect(decideAdmission({ ...base, inFlight: 200, priorityWeight: 16 })).toBe("queue");
    expect(decideAdmission({ ...base, inFlight: 200, priorityWeight: 8 })).toBe("reject");
  });
});
