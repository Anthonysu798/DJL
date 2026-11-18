import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  GroupId,
  GroupMemberId,
  ProjectId,
  ThreadId,
  type Group,
  type GroupEvent,
} from "@synara/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { cleanup, render } from "vitest-browser-react";

import { MultiAgentsScreen } from "~/multiAgents/MultiAgentsScreen";
import { useGroupStore } from "~/multiAgents/groupStore";

const state = vi.hoisted(() => ({ groups: [] as unknown[] }));

const api = vi.hoisted(() => ({
  groups: {
    onEvent: vi.fn((callback: (event: GroupEvent) => void) => {
      callback({ type: "snapshot", groups: state.groups as Group[], replies: [] });
      return () => {};
    }),
    create: vi.fn(),
  },
  harnesses: {
    listAccounts: vi.fn(async () => ({
      accounts: [{ id: "codex", installed: true, enabled: true, status: "ready" }],
    })),
  },
}));
vi.mock("~/nativeApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/nativeApi")>()),
  ensureNativeApi: () => api,
  readNativeApi: () => api,
}));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useNavigate: () => vi.fn(),
}));

const group: Group = {
  id: GroupId.makeUnsafe("g1"),
  threadId: ThreadId.makeUnsafe("t1"),
  projectId: ProjectId.makeUnsafe("p1"),
  name: "Launch team",
  folder: "/tmp/g1",
  folderIsAuto: true,
  hopLimit: 6,
  skipAllWarning: false,
  pendingHandoffs: [],
  members: [
    {
      id: GroupMemberId.makeUnsafe("m1"),
      groupId: GroupId.makeUnsafe("g1"),
      provider: "claudeAgent",
      handle: "Claude",
      role: null,
      model: null,
      position: 0,
    },
    {
      id: GroupMemberId.makeUnsafe("m2"),
      groupId: GroupId.makeUnsafe("g1"),
      provider: "codex",
      handle: "Codex",
      role: "reviewer",
      model: null,
      position: 1,
    },
  ],
  createdAt: 1,
  updatedAt: 1,
};

function mount() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MultiAgentsScreen
        selectedGroupId={undefined}
        onSelectGroup={() => {}}
        renderChat={(selected) => <div>chat for {selected.name}</div>}
      />
    </QueryClientProvider>,
  );
}

afterEach(async () => {
  await cleanup();
  useGroupStore.getState().reset();
  state.groups = [];
});

describe("MultiAgentsScreen", () => {
  it("lists groups with the Beta badge and opens the first one", async () => {
    state.groups = [group];
    await mount();
    await expect.element(page.getByRole("heading", { name: /Multi agents/ })).toBeVisible();
    await expect.element(page.getByText("Beta", { exact: true })).toBeVisible();
    await expect.element(page.getByRole("button", { name: /Launch team/ })).toBeVisible();
    await expect.element(page.getByText("chat for Launch team")).toBeVisible();
  });

  it("opens the two-step setup when there are no groups", async () => {
    await mount();
    await expect.element(page.getByText("Pick the agents for this group")).toBeVisible();
    await expect.element(page.getByText("Codex", { exact: true })).toBeVisible();
  });
});
