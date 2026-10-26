import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { admin } from "@/lib/api";
import { LocaleProvider, useI18n } from "@/components/LocaleProvider";
import ServersPage from "./page";

vi.mock("@/components/Shell", () => ({
  Shell: ({ children, title }: { children: ReactNode; title: string }) => (
    <div>
      <h1>{title}</h1>
      {children}
    </div>
  ),
}));
vi.mock("@/lib/api", () => ({ admin: vi.fn() }));
const fixture = () => ({
  host: "DJL preview VPS",
  canControl: true,
  sampledAt: Date.now() / 1000,
  latest: {
    at: Date.now() / 1000,
    cpu: 35,
    memoryUsed: 3 * 1024 ** 3,
    memoryTotal: 8 * 1024 ** 3,
    swapUsed: 0,
    swapTotal: 0,
    diskUsed: 65 * 1024 ** 3,
    diskTotal: 100 * 1024 ** 3,
    receiveRate: 1024,
    transmitRate: 2048,
    diskReadRate: 4096,
    diskWriteRate: 1024,
    uptime: 86400,
    load: [0.3, 0.4, 0.5],
  },
  history: [],
  services: [
    {
      service: "api",
      state: "running",
      health: "healthy",
      cpu: 1,
      memoryUsed: 128 * 1024 ** 2,
      memoryLimit: 8 * 1024 ** 3,
      restarts: 0,
      image: "sha256:fixture",
    },
  ],
  alerts: [],
  jobs: [],
  backups: [],
  releases: [],
  traffic: { requests: 120, errors: 2, averageLatencyMs: 15, history: [] },
});
beforeEach(() => {
  localStorage.clear();
  vi.mocked(admin).mockImplementation(async (path) => {
    if (path.startsWith("/servers/logs")) return { lines: ["Ready"] } as never;
    return fixture() as never;
  });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
describe("Servers dashboard", () => {
  it("renders real resource values and scoped service controls", async () => {
    render(<ServersPage />);
    await screen.findByText("35%");
    expect(screen.getByText("37.5%")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Restart api" }).hasAttribute("disabled")).toBe(
      false,
    );
    expect(screen.getByText("Memory history")).toBeTruthy();
    expect(screen.getByText("Verified deployments")).toBeTruthy();
  });
  it("shows controller failures and pauses disruptive actions", async () => {
    vi.mocked(admin).mockRejectedValue(new Error("VPS monitoring is not connected."));
    render(<ServersPage />);
    await screen.findByRole("alert");
    expect(screen.getByRole("button", { name: "Reboot VPS" }).hasAttribute("disabled")).toBe(true);
  });
  it("requires exact confirmation and current MFA before submitting", async () => {
    render(<ServersPage />);
    await screen.findByText("35%");
    fireEvent.click(screen.getByRole("button", { name: "Restart api" }));
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("dialog").querySelector('button[type="submit"]')!);
    await screen.findByText("Type the exact confirmation.");
    expect(vi.mocked(admin).mock.calls.some(([, opts]) => opts?.method === "POST")).toBe(false);
  });
  it("keeps non-operator administrators read-only", async () => {
    vi.mocked(admin).mockImplementation(async (path) =>
      path.startsWith("/servers/logs")
        ? ({ lines: [] } as never)
        : ({ ...fixture(), canControl: false } as never),
    );
    render(<ServersPage />);
    await screen.findByText("35%");
    expect(screen.getByRole("button", { name: "Restart api" }).hasAttribute("disabled")).toBe(true);
  });
  it("changes an open safety dialog without changing its typed confirmation", async () => {
    function Switch() {
      const { setLocale } = useI18n();
      return <button onClick={() => setLocale("fr")}>French</button>;
    }
    render(
      <LocaleProvider>
        <Switch />
        <ServersPage />
      </LocaleProvider>,
    );
    await screen.findByText("35%");
    fireEvent.click(screen.getByRole("button", { name: "Restart api" }));
    const field = await screen.findByLabelText("Type RESTART API");
    fireEvent.change(field, { target: { value: "RESTART API" } });
    fireEvent.click(screen.getByText("French"));
    expect((screen.getByLabelText("Saisissez RESTART API") as HTMLInputElement).value).toBe(
      "RESTART API",
    );
    expect(screen.getByRole("dialog").textContent).toContain("Redémarre uniquement");
    expect(vi.mocked(admin).mock.calls.some(([, opts]) => opts?.method === "POST")).toBe(false);
  });
});
