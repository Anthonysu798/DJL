// Browser regression coverage for recovering managed Work paths from server config.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { page } from "vitest/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "vitest-browser-react";

import { useWorkspaceStore } from "../../workspaceStore";
import { WorkIndexRouteView } from "./WorkIndexRouteView";

const mocks = vi.hoisted(() => ({
  getConfig: vi.fn(),
  handleNewStudioChat: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useNavigate: () => mocks.navigate,
}));

vi.mock("../../appSettings", () => ({
  useAppSettings: () => ({
    settings: {
      showStudioSection: true,
      sidebarThreadSortOrder: "updated_at",
    },
  }),
}));

vi.mock("../../composerDraftStore", () => ({
  useComposerDraftStore: (selector: (state: unknown) => unknown) =>
    selector({
      draftThreadsByThreadId: {},
      projectDraftThreadIdByProjectId: {},
    }),
}));

vi.mock("../../hooks/useHandleNewStudioChat", () => ({
  useHandleNewStudioChat: () => ({ handleNewStudioChat: mocks.handleNewStudioChat }),
}));

vi.mock("../../nativeApi", () => ({
  ensureNativeApi: () => ({ server: { getConfig: mocks.getConfig } }),
  readNativeApi: () => ({ server: { getConfig: mocks.getConfig } }),
}));

vi.mock("../../store", () => ({
  EMPTY_THREAD_IDS: [],
  useStore: (selector: (state: unknown) => unknown) =>
    selector({
      projects: [],
      sidebarThreadSummaryById: {},
      threadIds: [],
    }),
}));

vi.mock("../RestoreOrCreateChatRoute", () => ({
  RestoreOrCreateChatRoute: () => <div>Work route ready</div>,
}));

vi.mock("../SplashScreen", () => ({
  SplashScreen: ({ errorMessage }: { errorMessage?: string | null }) => (
    <div>{errorMessage ?? "Loading Work"}</div>
  ),
}));

describe("WorkIndexRouteView", () => {
  beforeEach(() => {
    mocks.getConfig.mockResolvedValue({
      homeDir: "/Users/tester",
      chatWorkspaceRoot: "/Users/tester/Documents/Synara",
      studioWorkspaceRoot: "/Users/tester/Documents/Synara/Studio",
    });
    mocks.handleNewStudioChat.mockReset();
    mocks.navigate.mockReset();
    useWorkspaceStore.setState({
      homeDir: null,
      chatWorkspaceRoot: null,
      studioWorkspaceRoot: null,
    });
  });

  afterEach(async () => {
    await cleanup();
    mocks.getConfig.mockReset();
  });

  it("recovers a missing managed Work root from the authoritative server config", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    await render(
      <QueryClientProvider client={queryClient}>
        <WorkIndexRouteView />
      </QueryClientProvider>,
    );

    await expect.poll(() => mocks.getConfig.mock.calls.length, { timeout: 1_000 }).toBe(1);
    await expect.element(page.getByText("Work route ready")).toBeInTheDocument();
    expect(useWorkspaceStore.getState().studioWorkspaceRoot).toBe(
      "/Users/tester/Documents/Synara/Studio",
    );
  });
});
