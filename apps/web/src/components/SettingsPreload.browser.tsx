import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render } from "vitest-browser-react";
import { usePreloadSettingsRoute } from "../hooks/usePreloadSettingsRoute";

const mocks = vi.hoisted(() => ({
  router: { preloadRoute: vi.fn(async () => undefined) },
  state: { status: "idle", resolvedLocation: { pathname: "/" } },
}));
vi.mock("@tanstack/react-router", () => ({
  useRouter: () => mocks.router,
  useRouterState: ({ select }: { select: (state: typeof mocks.state) => unknown }) =>
    select(mocks.state),
}));

function Probe() {
  usePreloadSettingsRoute();
  return <div>Preload probe</div>;
}

afterEach(async () => {
  await cleanup();
  vi.unstubAllGlobals();
  mocks.router.preloadRoute.mockClear();
});

it("waits for the first usable route before preloading Settings", async () => {
  const idle = vi.fn(() => 1);
  vi.stubGlobal("requestIdleCallback", idle);
  vi.stubGlobal("cancelIdleCallback", vi.fn());
  mocks.state = { status: "idle", resolvedLocation: { pathname: "/" } };
  const screen = await render(<Probe />);
  expect(idle).not.toHaveBeenCalled();
  mocks.state = { status: "pending", resolvedLocation: { pathname: "/thread-1" } };
  await screen.rerender(<Probe />);
  expect(idle).not.toHaveBeenCalled();
  mocks.state = { status: "idle", resolvedLocation: { pathname: "/thread-1" } };
  await screen.rerender(<Probe />);
  expect(idle).toHaveBeenCalledTimes(1);
});
