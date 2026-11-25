import "../../index.css";

import { ThreadId, type CloudSite } from "@djl/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { cleanup, render } from "vitest-browser-react";

import { PublishSiteDialog } from "./PublishSiteDialog";

const threadId = ThreadId.makeUnsafe("thread-1");
const site = (overrides: Partial<CloudSite> = {}): CloudSite =>
  ({
    id: "site-1",
    name: "bakery",
    url: "https://bakery.slcor.site",
    status: "active",
    liveDeploy: { id: "d1", status: "live", bytes: 10, fileCount: 1, createdAt: "", reason: null },
    pendingDeploy: null,
    createdAt: "",
    ...overrides,
  }) as CloudSite;

const api = vi.hoisted(() => ({
  sites: {
    projectStatus: vi.fn(),
    nameAvailable: vi.fn(),
    publish: vi.fn(),
    list: vi.fn(),
    unpublish: vi.fn(),
  },
  shell: { openExternal: vi.fn(async () => undefined) },
}));
vi.mock("~/nativeApi", () => ({ ensureNativeApi: () => api }));

function renderDialog() {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <PublishSiteDialog threadId={threadId} open onOpenChange={() => {}} />
    </QueryClientProvider>,
  );
}

describe("Publish site dialog", () => {
  beforeEach(() => {
    api.sites.projectStatus.mockResolvedValue({
      signedIn: true,
      projectAvailable: true,
      linkedSite: null,
      suggestedName: "bakery",
    });
    api.sites.nameAvailable.mockImplementation(async ({ name }: { name: string }) => ({
      name,
      available: name !== "taken-name",
      reason: name === "taken-name" ? "taken" : null,
    }));
  });
  afterEach(async () => {
    vi.clearAllMocks();
    await cleanup();
  });

  it("claims a name after the terms are accepted, then shows the live address", async () => {
    api.sites.publish.mockResolvedValue({ status: "published", site: site() });
    renderDialog();
    await expect.element(page.getByRole("textbox")).toHaveValue("bakery");
    await expect.element(page.getByText("This address is free.")).toBeVisible();
    const publish = page.getByRole("button", { name: "Publish", exact: true });
    await expect.element(publish).toBeDisabled();
    await page.getByRole("checkbox").click();
    await expect.element(publish).toBeEnabled();
    await publish.click();
    await expect.element(page.getByText("Your site is live")).toBeVisible();
    await expect.element(page.getByText("bakery.slcor.site", { exact: true })).toBeVisible();
    expect(api.sites.publish).toHaveBeenCalledWith({ threadId, name: "bakery", acceptTerms: true });
  });

  it("says when a name is taken and does not let it be published", async () => {
    renderDialog();
    await page.getByRole("textbox").fill("taken-name");
    await page.getByRole("checkbox").click();
    await expect.element(page.getByText("That address is taken. Try another.")).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Publish", exact: true })).toBeDisabled();
  });

  it("republishes a linked project without asking for a name", async () => {
    api.sites.projectStatus.mockResolvedValue({
      signedIn: true,
      projectAvailable: true,
      linkedSite: site(),
      suggestedName: "bakery",
    });
    api.sites.publish.mockResolvedValue({ status: "published", site: site() });
    renderDialog();
    await expect
      .element(page.getByText("This publishes the new version to bakery.slcor.site."))
      .toBeVisible();
    expect(page.getByRole("textbox").elements()).toHaveLength(0);
    await page.getByRole("button", { name: "Publish update" }).click();
    expect(api.sites.publish).toHaveBeenCalledWith({ threadId });
  });

  it("explains a failed build and shows its output", async () => {
    api.sites.projectStatus.mockResolvedValue({
      signedIn: true,
      projectAvailable: true,
      linkedSite: site(),
      suggestedName: "bakery",
    });
    api.sites.publish.mockResolvedValue({
      status: "failed",
      code: "build_failed",
      message: "The site's build failed.",
      log: "Type error: price is not defined",
    });
    renderDialog();
    await page.getByRole("button", { name: "Publish update" }).click();
    await expect.element(page.getByText("The site didn't build")).toBeVisible();
    await expect.element(page.getByText("Type error: price is not defined")).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Try again" })).toBeVisible();
  });

  it("tells the user when a version is held for review", async () => {
    api.sites.publish.mockResolvedValue({
      status: "published",
      site: site({
        pendingDeploy: {
          id: "d2",
          status: "held",
          bytes: 1,
          fileCount: 1,
          createdAt: "",
          reason: "A page has a password field.",
        },
      } as Partial<CloudSite>),
    });
    renderDialog();
    await page.getByRole("checkbox").click();
    await page.getByRole("button", { name: "Publish", exact: true }).click();
    await expect.element(page.getByText("Your site is waiting for review")).toBeVisible();
  });
});
