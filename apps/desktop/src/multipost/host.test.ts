import { it, expect } from "vitest";
import type { MultiPostBrowserRuntime } from "@synara/contracts";
import { startMultiPostHost } from "./host";
it("requires its private token and propagates cancelled preparation to the desktop", async () => {
  let aborted = false;
  let began!: () => void;
  const started = new Promise<void>((resolve) => {
    began = resolve;
  });
  const runtime: MultiPostBrowserRuntime = {
    available: async () => true,
    connect: async () => {},
    identity: async () => null,
    disconnect: async () => {},
    prepare: async (_context, signal) => {
      began();
      return new Promise((_, reject) =>
        signal?.addEventListener(
          "abort",
          () => {
            aborted = true;
            reject(new Error("cancelled"));
          },
          { once: true },
        ),
      );
    },
    submit: async () => ({ state: "uncertain", observedAt: new Date().toISOString() }),
    verify: async () => ({ state: "uncertain", observedAt: new Date().toISOString() }),
    cancel: async () => ({ state: "uncertain", observedAt: new Date().toISOString() }),
  };
  const host = await startMultiPostHost(runtime);
  try {
    const denied = await fetch(host.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer wrong" },
      body: JSON.stringify({ action: "available" }),
    });
    expect(denied.status).toBe(401);
    const fromPage = await fetch(host.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${host.token}`, Origin: "https://example.com" },
      body: JSON.stringify({ action: "available" }),
    });
    expect(fromPage.status).toBe(401);
    const controller = new AbortController();
    const pending = fetch(host.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${host.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "prepare", context: {} }),
      signal: controller.signal,
    });
    await started;
    controller.abort();
    await expect(pending).rejects.toThrow();
    await expect.poll(() => aborted, { timeout: 1000 }).toBe(true);
  } finally {
    await host.close();
  }
});

it("passes a finished-post notice on to the desktop", async () => {
  const seen: unknown[] = [];
  const runtime = {
    available: async () => true,
    notify: async (notice: unknown) => {
      seen.push(notice);
    },
  } as unknown as MultiPostBrowserRuntime;
  const host = await startMultiPostHost(runtime);
  try {
    const notice = { kind: "posted", platformKey: "instagram", label: "@djl.app" };
    const response = await fetch(host.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${host.token}` },
      body: JSON.stringify({ action: "notify", notice }),
    });
    expect(response.status).toBe(200);
    expect(seen).toEqual([notice]);
  } finally {
    await host.close();
  }
});

it("asks the desktop for a post's link", async () => {
  const seen: unknown[] = [];
  const runtime = {
    available: async () => true,
    postLink: async (context: unknown) => {
      seen.push(context);
      return "https://www.instagram.com/p/DCabc_123-x/";
    },
  } as unknown as MultiPostBrowserRuntime;
  const host = await startMultiPostHost(runtime);
  try {
    const context = { job: { id: "job" } };
    const response = await fetch(host.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${host.token}` },
      body: JSON.stringify({ action: "postLink", context }),
    });
    expect(await response.json()).toEqual({ result: "https://www.instagram.com/p/DCabc_123-x/" });
    expect(seen).toEqual([context]);
  } finally {
    await host.close();
  }
});
