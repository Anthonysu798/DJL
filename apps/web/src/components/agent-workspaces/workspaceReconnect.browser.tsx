import "../../index.css";
import { afterEach, expect, it, vi } from "vitest";
import { render, cleanup } from "vitest-browser-react";
import type { TerminalEvent, TerminalOpenInput } from "@synara/contracts";
import { TerminalPane } from "./AgentWorkspacesView";
import { workspaceTerminalSessions } from "./workspaceTerminalSessions";
import {
  terminalRuntimeRegistry,
  buildTerminalRuntimeKey,
} from "../terminal/terminalRuntimeRegistry";

const backend = vi.hoisted(() => ({
  events: new Set<(event: TerminalEvent) => void>(),
  transport: new Set<(state: "closed" | "open") => void>(),
  open: vi.fn(async (input: TerminalOpenInput) => ({
    ...input,
    terminalId: input.terminalId!,
    status: "running",
    pid: 42,
    history: "",
    screen: input.screenSnapshot ? "RESTORED" : undefined,
    headlessQueries: true,
    exitCode: null,
    exitSignal: null,
    updatedAt: "now",
  })),
  close: vi.fn(async () => {}),
}));
vi.mock("~/nativeApi", () => {
  const api = {
    terminal: {
      open: backend.open,
      close: backend.close,
      write: async () => {},
      resize: async () => {},
      ackOutput: async () => {},
      clear: async () => {},
      onEvent: (listener: (event: TerminalEvent) => void) => {
        backend.events.add(listener);
        return () => backend.events.delete(listener);
      },
    },
  };
  return { readNativeApi: () => api, ensureNativeApi: () => api };
});
vi.mock("~/wsTransportEvents", () => ({
  addWsTransportStateListener: (listener: (state: "closed" | "open") => void) => {
    backend.transport.add(listener);
    return () => backend.transport.delete(listener);
  },
}));
const workspace = {
  id: "reconnect-workspace",
  name: "Reconnect",
  cwd: "/tmp",
  projectId: null,
  layout: "grid" as const,
  panes: [{ id: "one", profileId: null, action: "run" as const }],
};
const key = buildTerminalRuntimeKey(workspace.id, "one");
const noAction = () => {};
async function mount() {
  return render(
    <div style={{ width: 800, height: 400 }}>
      <TerminalPane
        workspace={workspace}
        pane={workspace.panes[0]!}
        profile={undefined}
        maximized={false}
        onMaximize={noAction}
        onClose={noAction}
        onDuplicate={noAction}
      />
    </div>,
  );
}
afterEach(async () => {
  await cleanup();
  await workspaceTerminalSessions.close(workspace.id, "one");
  vi.clearAllMocks();
});
it("recovers a parked terminal exactly once on real reconnect without recreating or restarting it", async () => {
  const screen = await mount();
  await vi.waitFor(() => expect(terminalRuntimeRegistry.peek(key)?.runtimeStatus).toBe("ready"));
  const terminal = terminalRuntimeRegistry.peek(key)!.terminal;
  await screen.unmount();
  const opens = backend.open.mock.calls.length;
  for (const listener of backend.transport) listener("closed");
  expect(workspaceTerminalSessions.get(workspace.id, "one")?.state.status).toBe("connecting");
  for (const listener of backend.transport) listener("open");
  await vi.waitFor(() =>
    expect(workspaceTerminalSessions.get(workspace.id, "one")?.state.status).toBe("ready"),
  );
  expect(backend.open).toHaveBeenCalledTimes(opens + 1);
  expect(terminalRuntimeRegistry.peek(key)!.terminal === terminal).toBe(true);
  expect(backend.close).not.toHaveBeenCalled();
  await mount();
  expect(backend.open).toHaveBeenCalledTimes(opens + 1);
  expect(terminalRuntimeRegistry.peek(key)!.terminal === terminal).toBe(true);
});
it("keeps an exited parked terminal exited across return navigation and reconnect", async () => {
  const screen = await mount();
  await vi.waitFor(() => expect(terminalRuntimeRegistry.peek(key)?.runtimeStatus).toBe("ready"));
  const terminal = terminalRuntimeRegistry.peek(key)!.terminal;
  for (const listener of backend.events)
    listener({
      type: "exited",
      threadId: workspace.id,
      terminalId: "one",
      createdAt: "now",
      exitCode: 0,
      exitSignal: null,
    });
  await screen.unmount();
  const opens = backend.open.mock.calls.length;
  for (const listener of backend.transport) listener("closed");
  for (const listener of backend.transport) listener("open");
  await mount();
  expect(backend.open).toHaveBeenCalledTimes(opens);
  expect(workspaceTerminalSessions.get(workspace.id, "one")?.state.exited).toBe(true);
  expect(terminalRuntimeRegistry.peek(key)!.terminal === terminal).toBe(true);
  expect(backend.close).not.toHaveBeenCalled();
});
