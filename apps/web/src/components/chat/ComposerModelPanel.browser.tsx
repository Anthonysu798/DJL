import "../../index.css";

import type { ModelSlug, ProviderKind, ThreadId } from "@djl/contracts";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { afterEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { cleanup, render } from "vitest-browser-react";

import { ComposerModelPanel } from "./ComposerModelPanel";

const NOW = new Date().toISOString();
const ready = (provider: ProviderKind) => ({
  provider,
  status: "ready" as const,
  available: true,
  authStatus: "authenticated" as const,
  checkedAt: NOW,
});
const modelOptionsByProvider = {
  codex: [
    { slug: "gpt-a", name: "GPT A" },
    { slug: "gpt-b", name: "GPT B" },
  ],
  claudeAgent: [{ slug: "claude-x", name: "Claude X" }],
} as unknown as Record<ProviderKind, ReadonlyArray<{ slug: string; name: string }>>;

afterEach(async () => {
  await cleanup();
  localStorage.clear();
});

async function mount() {
  const onProviderModelChange = vi.fn();
  const onClose = vi.fn();
  const root = createRootRoute({
    component: () => (
      <div className="dark w-[22rem] bg-background text-foreground">
        <ComposerModelPanel
          provider="codex"
          model={"gpt-a" as ModelSlug}
          lockedProvider={null}
          providers={[ready("codex"), ready("claudeAgent")]}
          modelOptionsByProvider={
            new Proxy(modelOptionsByProvider, {
              get: (target, key) => (target as Record<string, unknown>)[key as string] ?? [],
            })
          }
          onProviderModelChange={onProviderModelChange}
          onClose={onClose}
          threadId={"thread-1" as ThreadId}
          modelOptions={undefined}
          prompt=""
          onPromptChange={() => undefined}
        />
      </div>
    ),
  });
  const settings = createRoute({ getParentRoute: () => root, path: "/settings" });
  const router = createRouter({
    routeTree: root.addChildren([settings]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await render(<RouterProvider router={router} />);
  return { onProviderModelChange, onClose };
}

it("picks a model with its number shortcut and closes", async () => {
  const { onProviderModelChange, onClose } = await mount();
  await expect.element(page.getByRole("option", { name: /GPT B/ })).toBeVisible();
  await userEvent.keyboard("{Meta>}2{/Meta}");
  await expect.poll(() => onProviderModelChange.mock.calls[0]).toEqual(["codex", "gpt-b"]);
  expect(onClose).toHaveBeenCalled();
});

it("keeps starred models in Favourites and searches across providers", async () => {
  await mount();
  await page.getByRole("button", { name: "Add GPT B to favourites" }).click();
  await page.getByRole("tab", { name: "Favourites" }).click();
  await expect.element(page.getByRole("option", { name: /GPT B/ })).toBeVisible();
  expect(page.getByRole("option", { name: /GPT A/ }).elements()).toHaveLength(0);
  await page.getByRole("searchbox").fill("claude");
  await expect.element(page.getByRole("option", { name: /Claude X/ })).toBeVisible();
});
