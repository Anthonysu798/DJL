import "../../index.css";

import type { SkillsStoreCatalogEntry, SkillsStoreSnapshot } from "@djl/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { cleanup, render } from "vitest-browser-react";

import { SkillsStoreView } from "./SkillsStore";

const entry = (overrides: Partial<SkillsStoreCatalogEntry>): SkillsStoreCatalogEntry => ({
  id: "acme/design/polish",
  name: "polish",
  repo: "acme/design",
  path: "skills/polish",
  commit: "a".repeat(40),
  sha256: "x",
  license: "MIT",
  category: "design",
  summary: { en: "Polish an interface until it feels right." },
  hasScripts: false,
  installs: 12_300,
  ...overrides,
});

const catalog = [
  entry({}),
  entry({
    id: "acme/tools/runner",
    name: "runner",
    repo: "acme/tools",
    category: "tools",
    hasScripts: true,
    installs: 900,
    summary: { en: "Runs checks for you." },
  }),
  entry({
    id: "anthropics/skills/docx",
    name: "docx",
    repo: "anthropics/skills",
    category: "documents",
    builtIn: true,
    summary: { en: "Word documents." },
  }),
];
const empty: SkillsStoreSnapshot = { catalog, installed: [] };
const installedRunner: SkillsStoreSnapshot = {
  catalog,
  installed: [
    {
      id: "acme/tools/runner",
      name: "runner",
      repo: "acme/tools",
      path: "skills/runner",
      commit: "a".repeat(40),
      license: "MIT",
      source: "curated",
      installedAt: "2026-11-24T00:00:00.000Z",
      edited: false,
      updateAvailable: false,
    },
  ],
};

const api = vi.hoisted(() => ({
  skillsStore: {
    snapshot: vi.fn(),
    search: vi.fn(),
    preview: vi.fn(async () => ({ markdown: "---\nname: polish\n---\n# Polish" })),
    install: vi.fn(),
    remove: vi.fn(),
  },
  shell: { openExternal: vi.fn() },
}));
vi.mock("~/nativeApi", () => ({ ensureNativeApi: () => api }));

function renderStore() {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <SkillsStoreView heading={<h1>Plugins</h1>} />
    </QueryClientProvider>,
  );
}

describe("Skills store", () => {
  beforeEach(() => {
    api.skillsStore.snapshot.mockResolvedValue(empty);
    api.skillsStore.search.mockResolvedValue({ results: [] });
  });
  afterEach(async () => {
    vi.clearAllMocks();
    await cleanup();
  });

  it("lists reviewed skills by category and marks built-in ones", async () => {
    renderStore();
    await expect.element(page.getByRole("region", { name: "Design" })).toBeVisible();
    await expect.element(page.getByText("Polish an interface until it feels right.")).toBeVisible();
    await expect.element(page.getByText("acme · MIT · 12.3K installs")).toBeVisible();
    await expect.element(page.getByText("Built in")).toBeVisible();
    expect(page.getByRole("button", { name: "Install docx" }).elements()).toHaveLength(0);
  });

  it("asks before installing a skill with scripts, then installs it", async () => {
    api.skillsStore.install
      .mockResolvedValueOnce({ status: "needsConsent", reason: "scripts", files: ["run.sh"] })
      .mockResolvedValueOnce({ status: "done", snapshot: installedRunner });
    renderStore();
    await page.getByRole("button", { name: "Install runner" }).click();
    await expect.element(page.getByRole("alertdialog")).toBeVisible();
    await expect.element(page.getByText("run.sh")).toBeVisible();
    await page.getByRole("button", { name: "Install anyway" }).click();
    expect(api.skillsStore.install).toHaveBeenLastCalledWith({
      id: "acme/tools/runner",
      allowScripts: true,
    });
    await expect
      .element(page.getByRole("region", { name: "Installed" }).getByText("runner"))
      .toBeVisible();
  });

  it("searches skills.sh and labels results as not reviewed", async () => {
    api.skillsStore.search.mockResolvedValue({
      results: [
        {
          id: "someone/kit/helper",
          name: "helper",
          repo: "someone/kit",
          installs: 40,
          installable: true,
        },
        {
          id: "docs.example.com/guide",
          name: "guide",
          repo: "docs.example.com",
          installs: 2,
          installable: false,
        },
      ],
    });
    renderStore();
    await page.getByRole("textbox", { name: "Search skills" }).fill("help");
    await expect.element(page.getByText("helper")).toBeVisible();
    await expect.element(page.getByText("Not reviewed").first()).toBeVisible();
    await expect.element(page.getByText("Not on GitHub")).toBeVisible();
    expect(api.skillsStore.search).toHaveBeenCalledWith({ query: "help" });
  });

  it("shows SKILL.md in the detail sheet", async () => {
    renderStore();
    await page.getByRole("button", { name: /^polish/ }).click();
    await expect.element(page.getByRole("dialog").getByText("# Polish")).toBeVisible();
    expect(api.skillsStore.preview).toHaveBeenCalledWith({ id: "acme/design/polish" });
  });
});
