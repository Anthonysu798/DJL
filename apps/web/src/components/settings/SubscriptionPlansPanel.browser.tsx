import "../../index.css";
import { CODING_PLANS, type CodingPlanStatus } from "@djl/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { cleanup, render } from "vitest-browser-react";
import { SubscriptionPlansPanel } from "./SubscriptionPlansPanel";

const KEY = "fake-key-0000-7788";

const api = vi.hoisted(() => {
  const statuses = new Map<string, { connected: boolean; keyHint?: string }>();
  return {
    statuses,
    shell: { openExternal: vi.fn(async (_url: string) => {}) },
    harnesses: { startLogin: vi.fn() },
    provider: { listModelProviders: vi.fn() },
    codingPlans: {
      list: vi.fn(async () => ({ plans: [] as CodingPlanStatus[] })),
      connect: vi.fn(),
      disconnect: vi.fn(async ({ planId }: { planId: string }) => {
        statuses.delete(planId);
        return { planId, connected: false };
      }),
      importFromOpenCode: vi.fn(),
    },
  };
});
vi.mock("~/nativeApi", () => ({ ensureNativeApi: () => api }));

beforeEach(() => {
  api.statuses.clear();
  api.codingPlans.list.mockImplementation(async () => ({
    plans: CODING_PLANS.map((plan) => ({
      planId: plan.id,
      connected: api.statuses.get(plan.id)?.connected ?? false,
      ...(api.statuses.get(plan.id)?.keyHint
        ? { keyHint: api.statuses.get(plan.id)!.keyHint }
        : {}),
      openCodeKeyAvailable: plan.id === "minimax-coding-plan",
    })),
  }));
});
afterEach(async () => {
  await cleanup();
  vi.clearAllMocks();
});

async function mount() {
  await render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <SubscriptionPlansPanel />
    </QueryClientProvider>,
  );
}

const row = (name: string) => page.getByRole("group", { name });

it("works without OpenCode and opens each plan's own key page, never an OpenCode login", async () => {
  await mount();
  await expect.element(row("Z.AI Coding Plan International")).toBeVisible();
  expect(api.provider.listModelProviders).not.toHaveBeenCalled();
  expect(page.getByRole("group", { name: /GitLab/ }).elements()).toHaveLength(0);
  expect(page.getByRole("group", { name: /Copilot/ }).elements()).toHaveLength(0);

  for (const plan of CODING_PLANS) {
    const region = plan.region === "china" ? "Mainland China" : "International";
    const button = row(`${plan.name} ${region}`).getByRole("button", { name: "Connect" });
    await expect.element(button).toBeEnabled();
    await button.click();
    await expect.poll(() => api.shell.openExternal.mock.calls.at(-1)?.[0]).toBe(plan.keyUrl);
    await row(`${plan.name} ${region}`).getByRole("button", { name: "Cancel" }).click();
  }
  expect(api.harnesses.startLogin).not.toHaveBeenCalled();
  const requests = JSON.stringify([
    api.shell.openExternal.mock.calls,
    api.codingPlans.connect.mock.calls,
    api.codingPlans.list.mock.calls,
  ]);
  expect(requests.toLowerCase()).not.toContain("opencode");
});

it("validates a pasted key, masks it after saving, and shows each failure clearly", async () => {
  api.codingPlans.connect
    .mockResolvedValueOnce({ planId: "zai-coding-plan", connected: false, error: "invalid_key" })
    .mockRejectedValueOnce(new Error("socket hang up"))
    .mockImplementationOnce(async ({ planId }: { planId: string }) => {
      api.statuses.set(planId, { connected: true, keyHint: "7788" });
      return { planId, connected: true, keyHint: "7788" };
    });
  await mount();
  const zai = row("Z.AI Coding Plan International");
  await zai.getByRole("button", { name: "Connect" }).click();
  await expect
    .element(zai.getByText("Sign in on Z.AI Coding Plan’s site.", { exact: false }))
    .toBeVisible();
  const input = zai.getByLabelText("Z.AI Coding Plan plan key");
  await input.fill(KEY);

  await zai.getByRole("button", { name: "Check and save" }).click();
  await expect.element(zai.getByRole("alert")).toHaveTextContent("rejected this key");
  expect(api.codingPlans.connect).toHaveBeenLastCalledWith({
    planId: "zai-coding-plan",
    apiKey: KEY,
  });

  await zai.getByRole("button", { name: "Check and save" }).click();
  await expect.element(zai.getByRole("alert")).toHaveTextContent("Couldn’t reach Z.AI Coding Plan");

  await zai.getByRole("button", { name: "Check and save" }).click();
  await expect.element(zai.getByRole("status")).toHaveTextContent("Key saved");
  await expect.element(zai.getByText("Connected · key ending in 7788")).toBeVisible();
  expect(document.body.innerHTML).not.toContain(KEY);
  expect(document.querySelectorAll("input[type=password]")).toHaveLength(0);
});

it("disconnects a plan and offers a read-only import only where OpenCode has a key", async () => {
  api.statuses.set("kimi-for-coding", { connected: true, keyHint: "abcd" });
  await mount();
  const kimi = row("Kimi For Coding International");
  await expect.element(kimi.getByText("Connected · key ending in abcd")).toBeVisible();
  await kimi.getByRole("button", { name: "Disconnect" }).click();
  await expect
    .poll(() => api.codingPlans.disconnect.mock.calls[0]?.[0])
    .toEqual({
      planId: "kimi-for-coding",
    });
  await expect.element(kimi.getByText("Not connected")).toBeVisible();

  await expect
    .element(
      row("MiniMax Coding Plan International").getByRole("button", {
        name: "Import key from OpenCode",
      }),
    )
    .toBeVisible();
  expect(
    row("Z.AI Coding Plan International")
      .getByRole("button", { name: "Import key from OpenCode" })
      .elements(),
  ).toHaveLength(0);
});
