import "../../index.css";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { cleanup, render } from "vitest-browser-react";

import type { Thread } from "~/types";

import { LimitSwitchBanner } from "./LimitSwitchBanner";

const AT = "2099-04-08T18:00:00.000Z";

const api = vi.hoisted(() => ({
  server: { listProviderUsage: vi.fn(), getConfig: vi.fn() },
}));
vi.mock("~/nativeApi", () => ({ ensureNativeApi: () => api, readNativeApi: () => api }));
const handoff = vi.hoisted(() => ({ createThreadHandoff: vi.fn(), isCreatingHandoff: false }));
vi.mock("~/hooks/useThreadHandoff", () => ({ useThreadHandoff: () => handoff }));

function snapshot(provider: string, usedPercent: number) {
  return {
    provider,
    updatedAt: AT,
    limits: [{ window: "5h", usedPercent }],
    usageLines: [],
    source: "test",
  };
}

function thread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: "thread-1",
    session: null,
    error: null,
    modelSelection: { provider: "codex", model: "gpt-5" },
    ...overrides,
  } as Thread;
}

async function renderBanner(props: Partial<Parameters<typeof LimitSwitchBanner>[0]> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onDismiss = vi.fn();
  const banner = (key: string) => (
    <QueryClientProvider client={client}>
      <LimitSwitchBanner
        key={key}
        thread={thread()}
        handoffDisabled={false}
        rateLimitStatus={null}
        onDismiss={onDismiss}
        {...props}
      />
    </QueryClientProvider>
  );
  const view = await render(banner("first"));
  return { onDismiss, remount: () => view.rerender(banner("second")) };
}

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("LimitSwitchBanner", () => {
  it("warns when the chat's agent is low and continues with the agent with most quota left", async () => {
    api.server.listProviderUsage.mockResolvedValue([
      snapshot("codex", 95),
      snapshot("claudeAgent", 40),
      snapshot("cursor", 70),
    ]);
    api.server.getConfig.mockResolvedValue({ providers: [] });
    handoff.createThreadHandoff.mockResolvedValue("thread-2");
    await renderBanner();

    await expect.element(page.getByText(/Codex has 5% left on its 5h limit\./)).toBeVisible();
    await page.getByRole("button", { name: "Continue with Claude" }).click();
    expect(handoff.createThreadHandoff).toHaveBeenCalledWith(
      expect.objectContaining({ id: "thread-1" }),
      "claudeAgent",
      { prompt: "Continue this task from where the previous agent left off." },
    );
  });

  it("stays quiet while the chat's agent has quota left", async () => {
    api.server.listProviderUsage.mockResolvedValue([snapshot("codex", 50)]);
    api.server.getConfig.mockResolvedValue({ providers: [] });
    await renderBanner();
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(document.querySelector("[role=alert]")).toBeNull();
  });

  it("never offers an agent that is itself low", async () => {
    api.server.listProviderUsage.mockResolvedValue([
      snapshot("codex", 100),
      snapshot("claudeAgent", 95),
    ]);
    api.server.getConfig.mockResolvedValue({ providers: [] });
    await renderBanner();
    await expect.element(page.getByText(/Codex has 0% left/)).toBeVisible();
    expect(page.getByRole("button", { name: /Continue with/ }).elements()).toHaveLength(0);
  });

  it("offers a switch after a rate-limit error and stays dismissed for that window", async () => {
    api.server.listProviderUsage.mockResolvedValue([snapshot("claudeAgent", 20)]);
    api.server.getConfig.mockResolvedValue({ providers: [] });
    const limitedThread = thread({ error: "You've hit your usage limit." });
    const { onDismiss, remount } = await renderBanner({
      thread: limitedThread,
      handoffDisabled: true,
    });

    await expect.element(page.getByText("Codex hit a usage limit.")).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Continue with Claude" })).toBeDisabled();
    await page.getByRole("button", { name: "Dismiss rate limit status" }).click();
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(document.querySelector("[role=alert]")).toBeNull();

    await remount();
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(document.querySelector("[role=alert]")).toBeNull();
  });
});
