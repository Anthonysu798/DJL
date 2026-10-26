import { afterEach, describe, expect, it, vi } from "vitest";
import { ProductAnalyticsClient, type AnalyticsClientState } from "./productAnalytics";

afterEach(() => vi.useRealTimers());
const metadata = { platform: "desktop" as const, appVersion: "0.5.0", osVersion: "26.0", channel: "test" as const };
function fixture(fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>) {
  let stored: AnalyticsClientState | null = null;
  let scope = "fixture-owner";
  const requests: { url: string; body: unknown; headers: Headers }[] = [];
  const client = new ProductAnalyticsClient({ metadata, context: async () => ({ apiBaseUrl: "https://api.example.test", scope, authorization: `Bearer fixture-session-${scope}` }),
    storage: { read: async () => stored, write: async (next) => { stored = structuredClone(next); } },
    fetchImpl: async (url, init) => {
      requests.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null, headers: new Headers(init?.headers) });
      if (fetchImpl) return fetchImpl(url, init);
      return url.endsWith("/installations") ? Response.json({ credential: "a".repeat(43), installationId: (JSON.parse(String(init?.body)) as { installationId: string }).installationId }, { status: 201 }) : Response.json({ accepted: 1 });
    },
  });
  return { client, requests, state: () => stored, changeScope: (next: string) => { scope = next; } };
}

describe("opt-in bounded product analytics", () => {
  it("does not block product actions when account context is temporarily unavailable", async () => {
    const client = new ProductAnalyticsClient({ metadata, context: async () => { throw new Error("offline context"); },
      storage: { read: async () => null, write: async () => undefined } });
    await expect(client.setEnabled(true)).resolves.toBeUndefined();
    await expect(client.recordFeature("voice")).resolves.toBeUndefined();
    client.close();
  });

  it("updates installation metadata once instead of making an extra request for every action", async () => {
    const { client, requests } = fixture();
    await client.start(); await client.setEnabled(true);
    await client.recordFeature("local_task"); await client.recordFeature("images");
    expect(requests.filter((request) => request.url.endsWith("/installation")).length).toBeLessThanOrEqual(1);
    client.close();
  });
  it("does not restore consent after an older asynchronous write completes", async () => {
    let release!: () => void; let entered!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const firstWrite = new Promise<void>((resolve) => { entered = resolve; });
    let stored: AnalyticsClientState | null = null;
    const client = new ProductAnalyticsClient({ metadata, context: async () => ({ apiBaseUrl: "https://api.example.test", scope: "anonymous" }),
      storage: { read: async () => null, write: async (next) => { if (next.enabled) { entered(); await blocked; } stored = next; } },
    });
    const enabled = client.setEnabled(true); await firstWrite;
    const disabled = client.setEnabled(false); release();
    await Promise.all([enabled, disabled]);
    expect((stored as AnalyticsClientState | null)?.enabled).toBe(false);
    client.close();
  });

  it("discards an old account's queued events while retaining the new account's action", async () => {
    let offline = false;
    const { client, requests, changeScope } = fixture(async (url, init) => {
      if (offline) return new Response(null, { status: 503 });
      return url.endsWith("/installations") ? Response.json({ credential: "a".repeat(43), installationId: JSON.parse(String(init?.body)).installationId }, { status: 201 }) : Response.json({ accepted: 1 });
    });
    await client.start(); await client.setEnabled(true);
    offline = true; await client.recordFeature("local_task");
    offline = false; changeScope("new-owner"); await client.recordFeature("images");
    const posted = requests.filter((request) => request.url.endsWith("/events") && request.headers.get("authorization")?.endsWith("new-owner"));
    expect(JSON.stringify(posted.map((request) => request.body))).toContain("images");
    expect(JSON.stringify(posted.map((request) => request.body))).not.toContain("local_task");
    client.close();
  });
  it("makes no request before consent and cancels collection when disabled", async () => {
    const { client, requests, state } = fixture();
    await client.start(); client.setForeground(true); await client.recordFeature("local_task"); await client.flush();
    expect(requests).toHaveLength(0);
    await client.setEnabled(true); await client.flush();
    expect(requests.some((request) => request.url.endsWith("/events"))).toBe(true);
    const count = requests.length;
    await client.setEnabled(false); await client.recordFeature("voice"); await client.flush();
    expect(requests).toHaveLength(count);
    expect(state()?.events).toEqual([]);
    client.close();
  });

  it("reports allowlisted events without account identifiers or form contents", async () => {
    const { client, requests } = fixture();
    await client.start(); await client.setEnabled(true); await client.recordFeature("remote_control"); await client.flush();
    const body = requests.filter((request) => request.url.endsWith("/events")).map((request) => request.body);
    expect(JSON.stringify(body)).toContain("remote_control");
    expect(JSON.stringify(body)).not.toContain("fixture-owner");
    expect(JSON.stringify(body)).not.toContain("fixture-session");
    expect(body.every((batch) => Object.keys(batch as object).join(",") === "events")).toBe(true);
    client.close();
  });

  it("bounds a failing offline queue to 100 and sends at most 20 events at once", async () => {
    const { client, requests, state } = fixture(async (url, init) => url.endsWith("/installations") ? Response.json({ credential: "a".repeat(43), installationId: JSON.parse(String(init?.body)).installationId }) : new Response(null, { status: 503 }));
    await client.start(); await client.setEnabled(true);
    for (let i = 0; i < 110; i++) await client.recordFeature("images");
    expect(state()!.events.length).toBeLessThanOrEqual(100);
    await client.flush();
    const batches = requests.filter((request) => request.url.endsWith("/events"));
    expect(batches.every((request) => (request.body as { events: unknown[] }).events.length <= 20)).toBe(true);
    client.close();
  });
  it("stops heartbeats while backgrounded and never sends expired offline events", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-13T12:00:00Z"));
    let offline = false;
    const { client, requests, state } = fixture(async (url, init) => offline ? new Response(null, { status: 503 }) : url.endsWith("/installations") ? Response.json({ credential: "a".repeat(43), installationId: JSON.parse(String(init?.body)).installationId }) : Response.json({ accepted: 1 }));
    await client.start(); client.setForeground(true); await client.setEnabled(true);
    const before = requests.length;
    await vi.advanceTimersByTimeAsync(59_000); expect(requests).toHaveLength(before);
    await vi.advanceTimersByTimeAsync(1000); await client.flush(); await vi.waitFor(() => expect(requests.length).toBeGreaterThan(before));
    client.setForeground(false); await client.flush();
    await vi.waitFor(() => expect(JSON.stringify(requests.map((request) => request.body))).toContain("session_end"));
    const background = requests.length;
    await vi.advanceTimersByTimeAsync(180_000); expect(requests).toHaveLength(background);
    offline = true; await client.recordFeature("voice");
    vi.setSystemTime(new Date("2026-10-22T12:00:00Z")); offline = false;
    await client.flush(); expect(state()?.events).toEqual([]);
    client.close();
  });
  it("rejects a registration response for a different installation", async () => {
    const { client, requests, state } = fixture(async () => Response.json({ credential: "a".repeat(43), installationId: crypto.randomUUID() }));
    await client.setEnabled(true);
    expect(state()?.credential).toBeNull();
    expect(requests.some((request) => request.url.endsWith("/events"))).toBe(false);
    client.close();
  });
  it("recovers a pruned installation without retrying an unusable credential forever", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-13T12:00:00Z"));
    let pruned = false;
    const { client, state } = fixture(async (url, init) => url.endsWith("/installations") ? Response.json({ credential: "a".repeat(43), installationId: JSON.parse(String(init?.body)).installationId }) : pruned ? Response.json({ error: { code: "installation_required" } }, { status: 401 }) : Response.json({ accepted: 1 }));
    await client.setEnabled(true); const initial = state()?.installationId;
    pruned = true; await client.recordFeature("images"); pruned = false;
    await vi.advanceTimersByTimeAsync(31_000); await client.flush();
    expect(state()?.installationId).not.toBe(initial);
    expect(state()?.firstOpenReported).toBe(true);
    client.close();
  });

});
