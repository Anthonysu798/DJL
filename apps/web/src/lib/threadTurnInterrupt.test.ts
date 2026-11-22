import { beforeEach, expect, it, vi } from "vitest";
import { ThreadId } from "@djl/contracts";
import { interruptThreadTurn } from "./threadTurnInterrupt";
const fake = vi.hoisted(() => ({ revoke: vi.fn(), interrupt: vi.fn() }));
vi.mock("../nativeApi", () => ({
  ensureNativeApi: () => ({
    computer: { setControlEnabled: fake.revoke },
    orchestration: { dispatchCommand: fake.interrupt },
  }),
}));
beforeEach(() => {
  vi.resetAllMocks();
});
it("revokes Computer authority before requesting provider interruption", async () => {
  const calls: string[] = [];
  fake.revoke.mockImplementation(async () => {
    calls.push("revoked");
  });
  fake.interrupt.mockImplementation(async () => {
    calls.push("provider");
  });
  await interruptThreadTurn(ThreadId.makeUnsafe("fixture"));
  expect(calls).toEqual(["revoked", "provider"]);
  expect(fake.revoke).toHaveBeenCalledWith({ threadId: "fixture", enabled: false });
});
it("does not claim Stop succeeded when input cleanup is unacknowledged", async () => {
  fake.revoke.mockRejectedValue(new Error("cleanup pending"));
  await expect(interruptThreadTurn(ThreadId.makeUnsafe("fixture"))).rejects.toThrow(
    "cleanup pending",
  );
  expect(fake.interrupt).not.toHaveBeenCalled();
});
