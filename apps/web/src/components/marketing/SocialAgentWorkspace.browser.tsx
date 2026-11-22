import "../../index.css";
import { afterEach, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render, cleanup } from "vitest-browser-react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { defaultBrand } from "@djl/contracts";
import SocialAgentWorkspace from "./SocialAgentWorkspace";
import { SOCIAL_ACCOUNT_CHANGED } from "./accountCache";
import { buildThemeCssVariables, resolveThemePack, DEFAULT_THEME_STATE } from "~/theme/theme.logic";
const originalStyle = document.documentElement.style.cssText;
const originalClass = document.documentElement.className;
function applyTheme(variant: "light" | "dark") {
  document.documentElement.classList.toggle("dark", variant === "dark");
  const { variables } = buildThemeCssVariables(
    resolveThemePack(DEFAULT_THEME_STATE, variant),
    variant,
  );
  for (const [key, value] of Object.entries(variables))
    document.documentElement.style.setProperty(key, value);
}
const api = vi.hoisted(() => vi.fn());
vi.mock("./agentClient", () => ({ agentCommand: api }));
afterEach(async () => {
  await cleanup();
  document.documentElement.style.cssText = originalStyle;
  document.documentElement.className = originalClass;
  await page.viewport(1000, 1000);
});
function mount(onBack = vi.fn()) {
  api.mockReset();
  api.mockImplementation(async (_thread, tool) => {
    if (tool === "djl_brand_memory")
      return { profile: { ...defaultBrand, name: "Private workspace brand" }, version: 2 };
    if (tool === "djl_media_library") return { items: [], products: [], assetIds: [] };
    if (tool === "djl_social_workflows") return { workflows: [], runs: [], requiresReview: true };
    if (tool === "djl_repurpose_video") return { jobs: [], transcripts: [] };
    if (tool === "djl_social_inbox")
      return { items: [], retrievedAt: new Date().toISOString(), limitations: [] };
    if (tool === "djl_social_coach")
      return {
        days: 7,
        posts: [],
        providers: [],
        retrievedAt: new Date().toISOString(),
        limitations: ["No published posts in this period."],
      };
    throw new Error("Unsupported test action");
  });
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <SocialAgentWorkspace threadId="workspace-chat" onPrompt={async () => true} onBack={onBack} />
    </QueryClientProvider>,
  );
}
it("renders seven real tool views as a page without issuing a publishing action", async () => {
  await mount();
  await expect.element(page.getByRole("main", { name: "Social tools" })).toBeVisible();
  for (const name of [
    "Product link",
    "Workflows",
    "Video clips",
    "Media library",
    "Brand memory",
    "Results coach",
    "Review inbox",
  ]) {
    await page.getByRole("tab", { name, exact: true }).click();
    await expect
      .element(page.getByRole("tab", { name, exact: true }))
      .toHaveAttribute("aria-selected", "true");
  }
  await expect.poll(() => api.mock.calls.some((call) => call[1] === "djl_social_inbox")).toBe(true);
  expect(api.mock.calls.some((call) => call[2]?.action === "confirm")).toBe(false);
  expect(document.querySelector(".social-agent-page img")?.getAttribute("src")).toContain(
    "/illustrations/social-agent/",
  );
});
it("uses the illustration as an accessible navigation interaction", async () => {
  await mount();
  await page.getByRole("button", { name: "Explore video tools" }).click();
  await expect
    .element(page.getByRole("tab", { name: "Video clips", exact: true }))
    .toHaveAttribute("aria-selected", "true");
});
it("removes private tool views when the account changes", async () => {
  await mount();
  await page.getByRole("tab", { name: "Brand memory", exact: true }).click();
  await expect
    .element(page.getByLabelText("Brand name", { exact: true }))
    .toHaveValue("Private workspace brand");
  window.dispatchEvent(new Event(SOCIAL_ACCOUNT_CHANGED));
  await expect.element(page.getByLabelText("Brand name", { exact: true })).not.toBeInTheDocument();
  await expect.element(page.getByRole("status")).toHaveTextContent("Your account changed.");
});
it("keeps navigation and content within a phone-width viewport", async () => {
  await page.viewport(390, 844);
  await mount();
  await expect.element(page.getByRole("main", { name: "Social tools" })).toBeVisible();
  const workspace = document.querySelector<HTMLElement>(".social-agent-page")!;
  expect(workspace.getBoundingClientRect().right).toBeLessThanOrEqual(390);
  expect(workspace.scrollWidth).toBeLessThanOrEqual(workspace.clientWidth + 1);
});

it("returns to its chat without opening a dialog", async () => {
  const onBack = vi.fn();
  await mount(onBack);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  await page.getByRole("button", { name: "Back to chat" }).click();
  expect(onBack).toHaveBeenCalledOnce();
});
it("renders the desktop workspace for visual review", async () => {
  await page.viewport(1280, 900);
  applyTheme("light");
  await mount();
  await expect.element(page.getByLabelText("Product URL", { exact: true })).toBeVisible();
  await expect
    .poll(() => getComputedStyle(document.querySelector(".social-agent-layout")!).opacity)
    .toBe("1");
  await page.screenshot({ path: "/tmp/djl-social-tools-redesign-light.png" });
});

it("opens workflows and the inbox from the header shortcuts", async () => {
  await mount();
  await page.getByRole("button", { name: "Workflows", exact: true }).click();
  await expect
    .element(page.getByRole("tab", { name: "Workflows", exact: true }))
    .toHaveAttribute("aria-selected", "true");
  await page.getByRole("button", { name: "Review inbox", exact: true }).click();
  await expect
    .element(page.getByRole("tab", { name: "Review inbox", exact: true }))
    .toHaveAttribute("aria-selected", "true");
  await expect.poll(() => api.mock.calls.some((call) => call[1] === "djl_social_inbox")).toBe(true);
});
it("keeps every tool reachable from the horizontal dock on a small screen", async () => {
  await page.viewport(390, 844);
  applyTheme("light");
  await mount();
  await page.getByRole("tab", { name: "Brand memory", exact: true }).click();
  await expect
    .element(page.getByLabelText("Brand name", { exact: true }))
    .toHaveValue("Private workspace brand");
  await page.getByRole("tab", { name: "Product link", exact: true }).click();
  await expect.element(page.getByLabelText("Product URL", { exact: true })).toBeVisible();
  await page.screenshot({ path: "/tmp/djl-social-tools-redesign-mobile.png" });
});
it("renders the studio in the app's dark theme", async () => {
  await page.viewport(1280, 900);
  applyTheme("dark");
  await mount();
  await expect.element(page.getByLabelText("Product URL", { exact: true })).toBeVisible();
  await expect
    .poll(() => getComputedStyle(document.querySelector(".social-agent-layout")!).opacity)
    .toBe("1");
  await page.screenshot({ path: "/tmp/djl-social-tools-redesign-dark.png" });
});
