import "../../index.css";

import type { ServerListResult, ServerRecord } from "@synara/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { cleanup, render } from "vitest-browser-react";
import { createInstance } from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";

import englishCatalog from "../../i18n/locales/en.json";
import { ServersSettingsPanel } from "./ServersSettingsPanel";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  testConnection: vi.fn(),
  trustHostKey: vi.fn(),
  refreshStats: vi.fn(),
  importPreview: vi.fn(),
  importApply: vi.fn(),
  listLocalKeys: vi.fn(),
}));

vi.mock("~/env", () => ({ isElectron: true }));

vi.mock("~/nativeApi", () => ({
  ensureNativeApi: () => ({
    servers: {
      list: mocks.list,
      create: mocks.create,
      update: mocks.update,
      delete: mocks.delete,
      testConnection: mocks.testConnection,
      trustHostKey: mocks.trustHostKey,
      refreshStats: mocks.refreshStats,
      importPreview: mocks.importPreview,
      importApply: mocks.importApply,
      checkCapabilities: vi.fn(),
      listLocalKeys: mocks.listLocalKeys,
    },
  }),
}));

const now = Date.now();

const hk: ServerRecord = {
  id: "srv-hk" as ServerRecord["id"],
  name: "hk-edge",
  host: "edge.example.test",
  port: 2222,
  username: "deploy",
  auth: { type: "keyPath", path: "~/.ssh/id_ed25519", hasPassphrase: false },
  tags: ["prod", "hk"],
  permissionTier: "read-only",
  notes: "",
  source: "manual",
  lastTest: { at: now - 60_000, outcome: "ok", latencyMs: 87 },
  lastStats: {
    collectedAt: now - 30_000,
    hostname: "hk-edge",
    os: "Ubuntu 24.04.1 LTS",
    kernel: "Linux 6.8.0-45-generic",
    uptimeSeconds: 93_784,
    load: { one: 0.42, five: 0.35, fifteen: 0.3 },
    memory: { totalBytes: 8 * 1024 ** 3, usedBytes: 3 * 1024 ** 3 },
    disk: { totalBytes: 40 * 1024 ** 3, usedBytes: 12 * 1024 ** 3, mountPoint: "/" },
  },
  createdAt: now - 1_000_000,
  updatedAt: now - 60_000,
};

const fresh: ServerRecord = {
  id: "srv-new" as ServerRecord["id"],
  name: "tokyo-db",
  host: "db.example.test",
  port: 22,
  username: "root",
  auth: { type: "password" },
  tags: [],
  permissionTier: "approve-each",
  notes: "",
  source: "manual",
  createdAt: now,
  updatedAt: now,
};

const queryClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

async function mount(list: ServerListResult = { servers: [hk, fresh] }) {
  mocks.list.mockResolvedValue(list);
  mocks.listLocalKeys.mockResolvedValue({ keys: [] });
  mocks.testConnection.mockResolvedValue({ at: now, outcome: "ok", latencyMs: 50 });
  mocks.refreshStats.mockResolvedValue({ ok: true, stats: { collectedAt: now } });
  const i18n = createInstance();
  await i18n.use(initReactI18next).init({
    defaultNS: "common",
    fallbackLng: "en",
    lng: "en",
    interpolation: { escapeValue: false },
    resources: { en: englishCatalog },
  });
  return render(
    <QueryClientProvider client={queryClient()}>
      <I18nextProvider i18n={i18n}>
        <ServersSettingsPanel />
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

afterEach(async () => {
  await cleanup();
  vi.clearAllMocks();
});

describe("ServersSettingsPanel", () => {
  it("renders the empty state with both actions", async () => {
    await mount({ servers: [] });
    await expect.element(page.getByRole("heading", { name: "No servers yet" })).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Add server" })).toBeVisible();
    await expect
      .element(page.getByRole("button", { name: "Import from SSH config" }))
      .toBeVisible();
    await expect.element(page.getByRole("heading", { name: "Servers", exact: true })).toBeVisible();
  });

  it("lists servers with address, tags, tier and stats", async () => {
    await mount();
    await expect.element(page.getByRole("button", { name: /hk-edge/ })).toBeVisible();
    await expect.element(page.getByText("deploy@edge.example.test:2222")).toBeVisible();
    await expect.element(page.getByText("prod", { exact: true })).toBeInTheDocument();
    await expect.element(page.getByText("Read-only", { exact: true })).toBeVisible();
    await expect.element(page.getByText("Approve each", { exact: true })).toBeVisible();
    await expect.element(page.getByText("root@db.example.test")).toBeVisible();
    await expect.element(page.getByText("38%", { exact: true })).toBeInTheDocument();
  });

  it("expands a row to show details and bars", async () => {
    await mount();
    await page.getByRole("button", { name: /hk-edge/ }).click();
    await expect.element(page.getByText("Ubuntu 24.04.1 LTS")).toBeVisible();
    await expect.element(page.getByText("Linux 6.8.0-45-generic")).toBeVisible();
    await expect.element(page.getByText("3 GB / 8 GB")).toBeVisible();
    await expect.element(page.getByText(/Last tested/)).toBeVisible();
  });

  it("runs a connection test and shows the host key prompt, then trusts it", async () => {
    await mount({ servers: [fresh] });
    mocks.testConnection.mockResolvedValue({
      at: now,
      outcome: "host-key-unknown",
      hostKey: {
        type: "ssh-ed25519",
        fingerprint: "SHA256:abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG",
      },
    });
    mocks.trustHostKey.mockResolvedValue({ at: now, outcome: "ok", latencyMs: 40 });
    await page.getByRole("button", { name: /tokyo-db/ }).click();
    await page.getByRole("button", { name: "Test connection" }).click();
    await expect.element(page.getByRole("alert")).toBeVisible();
    await expect.element(page.getByText("Confirm this server's identity")).toBeVisible();
    await expect
      .element(page.getByText("SHA256:abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG"))
      .toBeVisible();
    expect(mocks.testConnection).toHaveBeenCalledWith({ id: "srv-new" });
    await page.getByRole("button", { name: "Trust this key" }).click();
    expect(mocks.trustHostKey).toHaveBeenCalledWith({
      id: "srv-new",
      fingerprint: "SHA256:abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG",
    });
    await expect.element(page.getByText("Reachable", { exact: true })).toBeVisible();
  });

  it("removes a server after confirmation", async () => {
    mocks.delete.mockResolvedValue(undefined);
    await mount({ servers: [fresh] });
    await page.getByRole("button", { name: "More options" }).click();
    await page.getByRole("menuitem", { name: "Remove" }).click();
    await expect.element(page.getByText("Remove tokyo-db?")).toBeVisible();
    await page.getByRole("button", { name: "Remove", exact: true }).click();
    expect(mocks.delete).toHaveBeenCalledWith({ id: "srv-new" });
    await expect.element(page.getByRole("heading", { name: "No servers yet" })).toBeVisible();
  });

  it("opens the editor, validates, and creates a server", async () => {
    mocks.create.mockResolvedValue({ ...fresh, id: "srv-created", name: "osaka" });
    await mount({ servers: [] });
    await page.getByRole("button", { name: "Add server" }).click();
    await expect.element(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect.element(page.getByText("Give this server a name.")).toBeVisible();
    await expect.element(page.getByText("Enter a hostname or IP address.")).toBeVisible();
    await page.getByLabelText("Name", { exact: true }).fill("osaka");
    await page.getByLabelText("Host", { exact: true }).fill("198.51.100.9");
    await page.getByLabelText("Username", { exact: true }).fill("root");
    await page.getByRole("radio", { name: "Password" }).click();
    await expect.element(page.getByText("# password via askpass")).toBeVisible();
    await page.getByLabelText("Password", { exact: true }).fill("hunter2");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    expect(mocks.create).toHaveBeenCalledTimes(1);
    const input = mocks.create.mock.calls[0]?.[0] as {
      auth: { type: string };
      secret?: { password?: string };
      host: string;
    };
    expect(input.auth.type).toBe("password");
    expect(input.secret?.password).toBe("hunter2");
    expect(input.host).toBe("198.51.100.9");
    await expect.element(page.getByText("osaka", { exact: true })).toBeVisible();
  });

  it("imports selected hosts from the SSH config preview", async () => {
    mocks.importPreview.mockResolvedValue({
      configPath: "/opt/djl-home/.ssh/config",
      candidates: [
        { alias: "hk", host: "203.0.113.10", port: 22, username: "deploy", alreadyImported: true },
        { alias: "work", host: "10.0.0.2", port: 22, alreadyImported: false },
      ],
    });
    mocks.importApply.mockResolvedValue({
      servers: [{ ...fresh, id: "srv-work", name: "work", host: "10.0.0.2" }],
    });
    await mount({ servers: [] });
    await page.getByRole("button", { name: "Import from SSH config" }).click();
    await expect.element(page.getByText("Already added")).toBeVisible();
    await page.getByRole("button", { name: "Import 1 selected" }).click();
    expect(mocks.importApply).toHaveBeenCalledWith({ aliases: ["work"] });
    await expect.element(page.getByText("work", { exact: true })).toBeVisible();
  });
});
