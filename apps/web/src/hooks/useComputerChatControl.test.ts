import { beforeEach, expect, it, vi } from "vitest";
import { ThreadId } from "@djl/contracts";
import { changeComputerChatControl } from "./useComputerChatControl";
const broker = vi.hoisted(() => ({ setControlEnabled: vi.fn() }));
vi.mock("~/nativeApi", () => ({ ensureNativeApi: () => ({ computer: broker }) }));
beforeEach(() => vi.resetAllMocks());
it("changes only the requested chat and waits for revocation before committing the UI state", async () => {
  let finish!: () => void;
  broker.setControlEnabled.mockReturnValue(
    new Promise<void>((resolve) => {
      finish = resolve;
    }),
  );
  const commit = vi.fn();
  const pending = changeComputerChatControl(ThreadId.makeUnsafe("fixture-chat"), false, commit);
  expect(commit).not.toHaveBeenCalled();
  expect(broker.setControlEnabled).toHaveBeenCalledWith({
    threadId: "fixture-chat",
    enabled: false,
  });
  finish();
  await pending;
  expect(commit).toHaveBeenCalledWith(false);
});
it("retains an explicit failure when the broker cannot confirm the change", async () => {
  broker.setControlEnabled.mockRejectedValue(new Error("cleanup not acknowledged"));
  const commit = vi.fn();
  await expect(
    changeComputerChatControl(ThreadId.makeUnsafe("fixture-chat"), false, commit),
  ).rejects.toThrow("cleanup not acknowledged");
  expect(commit).not.toHaveBeenCalled();
});
