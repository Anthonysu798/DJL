import "../../index.css";

import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  useSearch,
} from "@tanstack/react-router";
import { page } from "vitest/browser";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "vitest-browser-react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { SidebarProvider } from "~/components/ui/sidebar";
import englishCatalog from "~/i18n/locales/en.json";
import {
  FIRST_RUN_TOUR_STORAGE_KEY,
  FIRST_RUN_TOUR_VERSION,
  FIRST_RUN_TUTORIAL_REPLAY_TARGET,
  MODEL_GUIDE_STORAGE_KEY,
  MODEL_GUIDE_TARGET,
  MODEL_GUIDE_VERSION,
  SETTINGS_TOUR_STORAGE_KEY,
  SETTINGS_TOUR_VERSION,
  requestFirstRunTourReplay,
  requestModelGuideReplay,
  requestSettingsTourReplay,
  settingsTourTarget,
} from "~/onboarding/firstRunTour";
import {
  isSettingsSectionVisible,
  normalizeSettingsSection,
  SETTINGS_NAV_ITEMS,
} from "~/settingsNavigation";
import { useStore } from "~/store";
import { FirstRunTour } from "./FirstRunTour";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

const BROWSER_SETTINGS_TOUR_ITEMS = SETTINGS_NAV_ITEMS.filter(
  (item) => isSettingsSectionVisible(item.id) && !item.desktopOnly,
);

function settingsCatalogValue(path: string): string {
  let value: unknown = englishCatalog.settings;
  for (const segment of path.split(".")) {
    value = (value as Record<string, unknown>)?.[segment];
  }
  return String(value);
}

function TourFixture() {
  const routeSearch = useSearch({ strict: false }) as Record<string, unknown>;
  const activeSettingsSection = normalizeSettingsSection(routeSearch.section);
  const showLocalAiCard = routeSearch.localAi !== "hidden";

  return (
    <QueryClientProvider client={queryClient}>
      <SidebarProvider open>
        <div className="flex h-screen w-screen items-start gap-3 p-6">
          <button data-onboarding-target="work-mode" type="button">
            Work
          </button>
          <button data-onboarding-target="project-mode" type="button">
            Projects
          </button>
          {showLocalAiCard ? (
            <div data-onboarding-target="local-ai-card">
              <button data-onboarding-target="local-ai-purpose" type="button">
                Local AI purpose
              </button>
              <button data-onboarding-target="local-ai-device" type="button">
                Local AI device recommendation
              </button>
              <button data-onboarding-target="local-ai-prepare" type="button">
                Prepare local AI
              </button>
            </div>
          ) : null}
          <button data-onboarding-target="settings" type="button">
            Settings
          </button>
          <button data-onboarding-target={FIRST_RUN_TUTORIAL_REPLAY_TARGET} type="button">
            New user tutorial
          </button>
          <button
            data-onboarding-current-model="djl-qwen:7b"
            data-onboarding-target={MODEL_GUIDE_TARGET}
            type="button"
          >
            djl-qwen:7b
          </button>
          {BROWSER_SETTINGS_TOUR_ITEMS.map((item) => (
            <button
              key={item.id}
              data-onboarding-target={settingsTourTarget(item.id)}
              type="button"
            >
              {item.id}
            </button>
          ))}
          <output data-testid="active-settings-section">{activeSettingsSection}</output>
        </div>
        <FirstRunTour />
        <Outlet />
      </SidebarProvider>
    </QueryClientProvider>
  );
}

function createTourRouter(initialEntry = "/") {
  const rootRoute = createRootRoute({ component: TourFixture });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => null,
  });
  const settingsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/settings",
    component: () => null,
  });
  return createRouter({
    routeTree: rootRoute.addChildren([indexRoute, settingsRoute]),
    history: createMemoryHistory({ initialEntries: [initialEntry] }),
  });
}

describe("FirstRunTour", () => {
  afterEach(async () => {
    await cleanup();
    queryClient.clear();
    window.localStorage.clear();
    useStore.setState({ threadsHydrated: false });
  });

  it("replays the model guide directly and persists its independent version", async () => {
    window.localStorage.setItem(
      FIRST_RUN_TOUR_STORAGE_KEY,
      JSON.stringify({ seenVersion: FIRST_RUN_TOUR_VERSION }),
    );
    window.localStorage.setItem(
      MODEL_GUIDE_STORAGE_KEY,
      JSON.stringify({ seenVersion: MODEL_GUIDE_VERSION }),
    );
    useStore.setState({ threadsHydrated: true });
    await render(<RouterProvider router={createTourRouter()} />);

    requestModelGuideReplay();
    await expect.element(page.getByText("Choose the right brain for DJL")).toBeVisible();
    await expect.element(page.getByText("Current · djl-qwen:7b")).toBeVisible();
    await page.getByRole("button", { name: "Keep using local" }).click();

    expect(JSON.parse(window.localStorage.getItem(MODEL_GUIDE_STORAGE_KEY) ?? "{}")).toEqual({
      seenVersion: MODEL_GUIDE_VERSION,
    });
  });

  it("keeps the provider deep link visible instead of starting the settings tour", async () => {
    window.localStorage.setItem(
      FIRST_RUN_TOUR_STORAGE_KEY,
      JSON.stringify({ seenVersion: FIRST_RUN_TOUR_VERSION }),
    );
    window.localStorage.setItem(
      MODEL_GUIDE_STORAGE_KEY,
      JSON.stringify({ seenVersion: MODEL_GUIDE_VERSION }),
    );
    useStore.setState({ threadsHydrated: true });
    const router = createTourRouter();
    await render(<RouterProvider router={router} />);

    requestModelGuideReplay();
    await page.getByRole("button", { name: "Connect API model" }).click();

    await expect.poll(() => router.state.location.pathname).toBe("/settings");
    await expect
      .poll(() => (router.state.location.search as Record<string, unknown>).section)
      .toBe("models");
    await expect
      .poll(() => (router.state.location.search as Record<string, unknown>).target)
      .toBe("model-providers");
    await new Promise((resolve) => window.setTimeout(resolve, 900));
    expect(document.querySelector('[aria-label="DJL settings tutorial"]')).toBeNull();
  });

  it("walks through each anchored step and persists completion", async () => {
    window.localStorage.setItem(
      FIRST_RUN_TOUR_STORAGE_KEY,
      JSON.stringify({ seenVersion: FIRST_RUN_TOUR_VERSION }),
    );
    useStore.setState({ threadsHydrated: true });
    await render(<RouterProvider router={createTourRouter()} />);

    requestFirstRunTourReplay();
    await expect.element(page.getByText("Work mode", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Next" }).click();
    await expect.element(page.getByText("Project mode", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Next" }).click();
    await expect
      .element(page.getByText("Choose what local AI does best", { exact: true }))
      .toBeVisible();

    await page.getByRole("button", { name: "Next" }).click();
    await expect
      .element(page.getByText("A recommendation for this computer", { exact: true }))
      .toBeVisible();

    await page.getByRole("button", { name: "Back" }).click();
    await expect
      .element(page.getByText("Choose what local AI does best", { exact: true }))
      .toBeVisible();

    await page.getByRole("button", { name: "Next" }).click();
    await expect
      .element(page.getByText("A recommendation for this computer", { exact: true }))
      .toBeVisible();

    await page.getByRole("button", { name: "Next" }).click();
    await expect
      .element(page.getByText("Prepare local AI in one click", { exact: true }))
      .toBeVisible();

    await page.getByRole("button", { name: "Next" }).click();
    await expect.element(page.getByText("Settings", { exact: true }).last()).toBeVisible();

    await page.getByRole("button", { name: "Next" }).click();
    await expect.element(page.getByText("Replay tutorials anytime", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Finish" }).click();
    expect(document.querySelector('[aria-label="DJL new user tutorial"]')).toBeNull();
    expect(JSON.parse(window.localStorage.getItem(FIRST_RUN_TOUR_STORAGE_KEY) ?? "{}")).toEqual({
      seenVersion: FIRST_RUN_TOUR_VERSION,
    });
  });

  it("skips local AI steps when the zero-config card is not present", async () => {
    window.localStorage.setItem(
      FIRST_RUN_TOUR_STORAGE_KEY,
      JSON.stringify({ seenVersion: FIRST_RUN_TOUR_VERSION }),
    );
    useStore.setState({ threadsHydrated: true });
    await render(<RouterProvider router={createTourRouter("/?localAi=hidden")} />);

    requestFirstRunTourReplay();
    await expect.element(page.getByText("Work mode", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Next" }).click();
    await expect.element(page.getByText("Project mode", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Next" }).click();
    await expect.element(page.getByText("Settings", { exact: true }).last()).toBeVisible();
    await page.getByRole("button", { name: "Next" }).click();
    await expect.element(page.getByText("Replay tutorials anytime", { exact: true })).toBeVisible();
    expect(document.body.textContent).not.toContain("Choose what local AI does best");
  });

  it("walks through every visible settings category with separate persistence", async () => {
    window.localStorage.setItem(
      FIRST_RUN_TOUR_STORAGE_KEY,
      JSON.stringify({ seenVersion: FIRST_RUN_TOUR_VERSION }),
    );
    useStore.setState({ threadsHydrated: true });
    const router = createTourRouter("/settings?section=advanced");
    await render(<RouterProvider router={router} />);

    requestSettingsTourReplay();
    await expect.element(page.getByText("General", { exact: true }).last()).toBeVisible();
    const persistentTutorial = document.querySelector<HTMLElement>(
      '[aria-label="DJL settings tutorial"]',
    );
    expect(persistentTutorial).not.toBeNull();

    for (const [index, item] of BROWSER_SETTINGS_TOUR_ITEMS.entries()) {
      const label = settingsCatalogValue(item.labelKey);
      await expect.element(page.getByText(String(label), { exact: true }).last()).toBeVisible();
      await expect.element(page.getByTestId("active-settings-section")).toHaveTextContent(item.id);
      await expect
        .poll(() =>
          normalizeSettingsSection(
            (router.state.location.search as Record<string, unknown>).section,
          ),
        )
        .toBe(item.id);
      await page
        .getByRole("button", {
          name: index === BROWSER_SETTINGS_TOUR_ITEMS.length - 1 ? "Finish" : "Next",
        })
        .click();

      if (index === 0) {
        const nextItem = BROWSER_SETTINGS_TOUR_ITEMS[1]!;
        await expect
          .element(page.getByText(settingsCatalogValue(nextItem.labelKey), { exact: true }).last())
          .toBeVisible();
        expect(persistentTutorial?.isConnected).toBe(true);

        await page.getByRole("button", { name: "Back" }).click();
        await expect.element(page.getByText("General", { exact: true }).last()).toBeVisible();
        await expect
          .element(page.getByTestId("active-settings-section"))
          .toHaveTextContent("general");
        expect(persistentTutorial?.isConnected).toBe(true);
        await page.getByRole("button", { name: "Next" }).click();
      }
    }

    expect(document.querySelector('[aria-label="DJL settings tutorial"]')).toBeNull();
    expect(JSON.parse(window.localStorage.getItem(SETTINGS_TOUR_STORAGE_KEY) ?? "{}")).toEqual({
      seenVersion: SETTINGS_TOUR_VERSION,
    });
  });

  it("replays either tour from the other route", async () => {
    window.localStorage.setItem(
      FIRST_RUN_TOUR_STORAGE_KEY,
      JSON.stringify({ seenVersion: FIRST_RUN_TOUR_VERSION }),
    );
    window.localStorage.setItem(
      SETTINGS_TOUR_STORAGE_KEY,
      JSON.stringify({ seenVersion: SETTINGS_TOUR_VERSION }),
    );
    useStore.setState({ threadsHydrated: true });
    const router = createTourRouter();
    await render(<RouterProvider router={router} />);

    requestSettingsTourReplay();
    await expect.element(page.getByText("General", { exact: true }).last()).toBeVisible();
    await expect.poll(() => router.state.location.pathname).toBe("/settings");
    await page.getByRole("button", { name: "Skip" }).click();

    requestFirstRunTourReplay();
    await expect.element(page.getByText("Work mode", { exact: true })).toBeVisible();
    await expect.poll(() => router.state.location.pathname).toBe("/");
  });
});
