import { ThreadId, type ThreadComputerState } from "@synara/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import { useComputerChatControl } from "./useComputerChatControl";

const preferences = vi.hoisted(() => ({ overrides: {} as Record<string, boolean> }));
const current = vi.hoisted(() => ({ states: {} as Record<string, ThreadComputerState> }));
vi.mock("../computerStateStore", () => ({
  useComputerStateStore: (selector: (store: unknown) => unknown) =>
    selector({ threadStatesByThreadId: current.states }),
}));
vi.mock("./useLocalStorage", () => ({
  useLocalStorage: () => [preferences.overrides, vi.fn()],
}));

const threadId = ThreadId.makeUnsafe("owned-chat");
function renderedControl(defaultEnabled = false) {
  let control!: ReturnType<typeof useComputerChatControl>;
  function Probe() {
    control = useComputerChatControl(threadId, defaultEnabled);
    return <button aria-pressed={control.enabled}>Computer control</button>;
  }
  const markup = renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <Probe />
    </QueryClientProvider>,
  );
  return { control, markup };
}
function publish(id: ThreadId, enabled: boolean, version: number) {
  current.states[id] = {
    threadId: id,
    version,
    controlEnabled: enabled,
  } as unknown as ThreadComputerState;
}
beforeEach(() => {
  current.states = {};
  preferences.overrides = { [threadId]: true };
});

it("renders Off when floating Stop revokes an enabled chat, and On after explicit re-enable", () => {
  publish(threadId, true, 1);
  expect(renderedControl().control.enabled).toBe(true);
  publish(threadId, false, 2);
  expect(renderedControl().markup).toContain('aria-pressed="false"');
  publish(threadId, true, 3);
  expect(renderedControl().control.enabled).toBe(true);
});

it("does not turn on an ordinary chat just because the server gate is open", () => {
  preferences.overrides = {};
  publish(threadId, true, 1);
  expect(renderedControl().control.enabled).toBe(false);
});

it("does not apply another chat's revocation to this chat", () => {
  publish(ThreadId.makeUnsafe("other-chat"), false, 1);
  expect(renderedControl().control.enabled).toBe(true);
});

it("keeps an explicit local Off when a fresh server snapshot allows control", () => {
  preferences.overrides = { [threadId]: false };
  publish(threadId, true, 1);
  expect(renderedControl(true).control.enabled).toBe(false);
});
