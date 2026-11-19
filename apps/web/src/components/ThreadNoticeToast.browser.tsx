import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { cleanup, render } from "vitest-browser-react";
import { ToastProvider, toastManager } from "./ui/toast";
import "../index.css";

afterEach(cleanup);

function renderToasts() {
  const root = createRootRoute({
    component: () => <ToastProvider position="top-center">{null}</ToastProvider>,
  });
  const router = createRouter({
    routeTree: root,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  render(<RouterProvider router={router} />);
  // Toasts added before the viewport mounts are never shown.
  return expect.element(page.getByRole("region", { name: "Notifications" })).toBeInTheDocument();
}

function addNotice(onOpen: () => void) {
  toastManager.add({
    type: "success",
    title: "Game",
    description: "I'm Claude Opus 5.5 (model ID claude-opus-5-5), made by Anthropic.",
    data: {
      allowCrossThreadVisibility: true,
      threadNotice: {
        label: "Game",
        status: "Done",
        preview: "I'm Claude Opus 5.5 (model ID claude-opus-5-5), made by Anthropic.",
        tone: "done",
        onOpen,
      },
    },
  });
}

describe("thread notice toast", () => {
  it("shows the chat name, status and reply, and opens the chat from the whole card", async () => {
    await page.viewport(1280, 800);
    await renderToasts();
    const onOpen = vi.fn();
    addNotice(onOpen);

    const card = page.getByRole("button", { name: /Game\s*Done/ });
    await expect.element(card).toBeVisible();
    await expect
      .element(page.getByText("I'm Claude Opus 5.5 (model ID claude-opus-5-5), made by Anthropic."))
      .toBeVisible();
    // No separate "Open" button and no generic "Task complete" heading.
    expect(page.getByRole("button", { name: "Open", exact: true }).elements()).toHaveLength(0);
    expect(page.getByText("Task complete").elements()).toHaveLength(0);

    await card.click();
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it("dismisses from the close button without opening the chat", async () => {
    await renderToasts();
    const onOpen = vi.fn();
    addNotice(onOpen);
    await expect.element(page.getByRole("button", { name: /Game\s*Done/ })).toBeVisible();

    await page.getByRole("button", { name: "Dismiss toast" }).click();
    expect(onOpen).not.toHaveBeenCalled();
  });
});
