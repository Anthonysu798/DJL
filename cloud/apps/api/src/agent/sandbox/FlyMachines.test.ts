import { describe, expect, it } from "vitest";

import { FlyMachines, REAP_AFTER_MS, SANDBOX_ROLE, reapSandboxes } from "./FlyMachines.ts";
import { createFlySandbox } from "./Sandbox.ts";

interface Call {
  readonly method: string;
  readonly path: string;
  readonly body: unknown;
  readonly auth: string | null;
}

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

/** A fake Machines API: records calls and answers by route. */
function fakeFly(options: { readonly execStatus?: number; readonly machines?: unknown[] } = {}) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const path = url.pathname.replace("/v1/apps/djl-sandbox", "") + url.search;
    calls.push({
      method,
      path,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      auth: new Headers(init?.headers).get("authorization"),
    });
    if (method === "POST" && path === "/machines")
      return ok({ id: "m1", created_at: new Date().toISOString() });
    if (path.includes("/wait")) return ok({ ok: true });
    if (path.endsWith("/exec"))
      return options.execStatus
        ? new Response("boom", { status: options.execStatus })
        : ok({ exit_code: 0, stdout: "4\n", stderr: "" });
    if (method === "DELETE") return new Response("", { status: 200 });
    if (method === "GET" && path.startsWith("/machines?")) return ok(options.machines ?? []);
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  const machines = new FlyMachines({
    token: "fly-token",
    app: "djl-sandbox",
    image: "registry.fly.io/djl-sandbox:v1",
    fetchImpl,
  });
  return { machines, calls };
}

describe("FlyMachines sandbox", () => {
  it("creates a 1-CPU, 1 GB, auto-destroying, never-restarted machine with no services, labelled with the run", () => {
    const { machines } = fakeFly();
    const body = machines.machineConfig("0e7c1a55-1111-2222-3333-444455556666");
    expect(body.skip_service_registration).toBe(true);
    expect(body.config).toEqual({
      image: "registry.fly.io/djl-sandbox:v1",
      guest: { cpu_kind: "shared", cpus: 1, memory_mb: 1024 },
      auto_destroy: true,
      restart: { policy: "no" },
      services: [],
      metadata: { djl_role: SANDBOX_ROLE, djl_run_id: "0e7c1a55-1111-2222-3333-444455556666" },
    });
  });

  it("runs code through exec with a 60 s limit and destroys the machine on close", async () => {
    const { machines, calls } = fakeFly();
    const session = await createFlySandbox(machines).open("run-1");
    const result = await session.runPython("print(2 + 2)", new AbortController().signal);
    await session.close();
    expect(result).toMatchObject({ exitCode: 0, stdout: "4\n" });
    expect(calls.map((c) => `${c.method} ${c.path.split("?")[0]}`)).toEqual([
      "POST /machines",
      "GET /machines/m1/wait",
      "POST /machines/m1/exec",
      "DELETE /machines/m1",
    ]);
    const exec = calls[2]!.body as { command: string[]; timeout: number };
    expect(exec.timeout).toBe(60);
    expect(exec.command[0]).toBe("/opt/djl/run-python");
    expect(Buffer.from(exec.command[1]!, "base64").toString()).toBe("print(2 + 2)");
    expect(calls.every((c) => c.auth === "Bearer fly-token")).toBe(true);
    expect(calls[3]!.path).toContain("force=true");
  });

  it("still destroys the machine when exec fails", async () => {
    const { machines, calls } = fakeFly({ execStatus: 500 });
    const session = await createFlySandbox(machines).open("run-2");
    try {
      await expect(session.runPython("print(1)", new AbortController().signal)).rejects.toThrow();
    } finally {
      await session.close();
    }
    expect(calls.at(-1)).toMatchObject({ method: "DELETE" });
  });

  it("closing a session that never ran anything creates and destroys nothing", async () => {
    const { machines, calls } = fakeFly();
    await (await createFlySandbox(machines).open("run-3")).close();
    expect(calls).toHaveLength(0);
  });

  it("reaps sandbox machines older than 20 minutes and leaves younger ones", async () => {
    const now = new Date("2026-09-26T12:00:00Z");
    const age = (ms: number) => new Date(now.getTime() - ms).toISOString();
    const label = { metadata: { djl_role: SANDBOX_ROLE, djl_run_id: "r" } };
    const { machines, calls } = fakeFly({
      machines: [
        { id: "old", created_at: age(REAP_AFTER_MS + 1000), config: label },
        { id: "young", created_at: age(60_000), config: label },
        { id: "older", created_at: age(3 * REAP_AFTER_MS), config: label },
        { id: "other", created_at: age(3 * REAP_AFTER_MS), config: { metadata: {} } },
      ],
    });
    expect(await reapSandboxes(machines, now)).toBe(2);
    expect(calls.filter((c) => c.method === "DELETE").map((c) => c.path.split("?")[0])).toEqual([
      "/machines/old",
      "/machines/older",
    ]);
    expect(calls[0]!.path).toBe(`/machines?metadata.djl_role=${SANDBOX_ROLE}`);
  });
});
