import "../../index.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { cleanup, render } from "vitest-browser-react";
import { SubscriptionPlansPanel } from "./SubscriptionPlansPanel";

const api = vi.hoisted(() => ({
  provider: {
    listModelProviders: vi.fn(async () => ({
      providers: [
        {
          id: "zai-coding-plan",
          name: "Z.AI Coding Plan",
          connected: true,
          supportsApiKey: true,
          modelCount: 3,
        },
        {
          id: "zhipuai-coding-plan",
          name: "Zhipu AI Coding Plan",
          connected: false,
          supportsApiKey: true,
          modelCount: 0,
        },
        {
          id: "kimi-for-coding",
          name: "Kimi For Coding",
          connected: false,
          supportsApiKey: true,
          modelCount: 0,
        },
      ],
      configuredProviderCount: 1,
      modelCount: 3,
    })),
  },
}));
vi.mock("~/nativeApi", () => ({ ensureNativeApi: () => api }));
afterEach(async () => {
  await cleanup();
  vi.clearAllMocks();
});

async function mount(enabled = true) {
  const connect = vi.fn();
  await render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <SubscriptionPlansPanel enabled={enabled} disabled={false} onConnect={connect} />
    </QueryClientProvider>,
  );
  return connect;
}

it("keeps regional connection status separate and connects the exact selected plan", async () => {
  const connect = await mount();
  await expect
    .poll(() => api.provider.listModelProviders.mock.calls)
    .toEqual([[{ forceReload: true }]]);
  const international = page.getByRole("group", { name: "Z.AI Coding Plan", exact: true });
  const china = page.getByRole("group", { name: "Zhipu AI Coding Plan", exact: true });
  await expect.element(international.getByText("Connected", { exact: true })).toBeVisible();
  await expect.element(china.getByText("Sign-in required", { exact: true })).toBeVisible();
  await china.getByRole("button", { name: "Connect", exact: true }).click();
  expect(connect).toHaveBeenCalledWith({
    harness: "opencode",
    modelProviderId: "zhipuai-coding-plan",
  });
  await page
    .getByRole("group", { name: "Kimi For Coding", exact: true })
    .getByRole("button", { name: "Connect", exact: true })
    .click();
  expect(connect).toHaveBeenLastCalledWith({
    harness: "opencode",
    modelProviderId: "kimi-for-coding",
  });
});

it("does not connect a missing plan through a general API provider", async () => {
  await mount();
  const row = page.getByRole("group", { name: "MiniMax Token Plan (China)", exact: true });
  await expect.element(row.getByRole("button", { name: "Connect", exact: true })).toBeDisabled();
  await expect
    .element(row.getByText("Update OpenCode to check support for this plan."))
    .toBeVisible();
});

it("does not query or enable sign-in without an available OpenCode runtime", async () => {
  await mount(false);
  await expect
    .element(
      page
        .getByRole("group", { name: "Kimi For Coding", exact: true })
        .getByRole("button", { name: "Connect", exact: true }),
    )
    .toBeDisabled();
  expect(api.provider.listModelProviders).not.toHaveBeenCalled();
});
