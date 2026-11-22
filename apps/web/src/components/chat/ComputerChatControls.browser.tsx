import "../../index.css";
import { ThreadId, type ThreadComputerState } from "@djl/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { cleanup, render } from "vitest-browser-react";
import { useComputerStateStore } from "../../computerStateStore";
import { useComputerChatControl } from "../../hooks/useComputerChatControl";
import { rendererI18n } from "../../i18n";
import { ComputerChatControlButton } from "./ComputerChatControls";

const broker = vi.hoisted(() => ({ setControlEnabled: vi.fn() }));
vi.mock("~/nativeApi", () => ({ ensureNativeApi: () => ({ computer: broker }) }));
const threadId = ThreadId.makeUnsafe("owned-toggle-browser");
const storageKey = "djl:computer-control-by-thread:v1";
function publish(enabled: boolean, version: number) {
  useComputerStateStore.getState().upsertThreadState({
    threadId,
    version,
    controlEnabled: enabled,
  } as unknown as ThreadComputerState);
}
function Probe() {
  const control = useComputerChatControl(threadId, false);
  return <ComputerChatControlButton control={control} iconOnly={false} />;
}
afterEach(async () => {
  await cleanup();
  useComputerStateStore.getState().clear();
  localStorage.removeItem(storageKey);
  vi.resetAllMocks();
});

it("updates the real chat button on server Stop and re-enables with one click after acknowledgement", async () => {
  await rendererI18n.changeLanguage("en");
  localStorage.setItem(storageKey, JSON.stringify({ [threadId]: true }));
  publish(true, 1);
  await render(
    <QueryClientProvider client={new QueryClient()}>
      <Probe />
    </QueryClientProvider>,
  );
  const on = page.getByRole("button", { name: "Computer control is on for this chat" });
  const off = page.getByRole("button", { name: "Computer control is off" });
  await expect.element(on).toHaveAttribute("aria-pressed", "true");
  publish(false, 2);
  await expect.element(off).toHaveAttribute("aria-pressed", "false");
  let finish!: () => void;
  broker.setControlEnabled.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  await off.click();
  expect(broker.setControlEnabled).toHaveBeenCalledExactlyOnceWith({ threadId, enabled: true });
  await expect.element(off).toBeDisabled();
  publish(true, 3);
  finish();
  await expect.element(on).toBeEnabled();
  await expect.element(on).toHaveAttribute("aria-pressed", "true");
  publish(false, 4);
  await expect.element(off).toHaveAttribute("aria-pressed", "false");
});
