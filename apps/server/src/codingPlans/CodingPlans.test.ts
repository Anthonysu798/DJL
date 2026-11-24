import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CODING_PLANS, findCodingPlan } from "@djl/contracts";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ServerSecretStoreShape } from "../auth/Services/ServerSecretStore";
import { codingPlanSecretName, makeCodingPlans, readOpenCodePlanKey } from "./CodingPlans";
import { validateCodingPlanKey } from "./validateKey";

const KEY = "fake-key-0000-1234";

function memoryStore() {
  const values = new Map<string, Uint8Array>();
  const store: ServerSecretStoreShape = {
    get: (name) => Effect.succeed(values.get(name) ?? null),
    set: (name, value) => Effect.sync(() => void values.set(name, value)),
    getOrCreateRandom: () => Effect.die("unused"),
    remove: (name) => Effect.sync(() => void values.delete(name)),
    pathOf: (name) => `/memory/${name}`,
  };
  return { store, values };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function tempRoot() {
  const root = await mkdtemp(join(tmpdir(), "djl-coding-plans-"));
  roots.push(root);
  return root;
}

describe("validateCodingPlanKey", () => {
  it.each(CODING_PLANS.map((plan) => [plan.id, plan] as const))(
    "sends %s's check to the plan's own endpoint",
    async (_id, plan) => {
      const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => json(200, {}));
      await expect(validateCodingPlanKey(plan, KEY, { fetch: fetchMock })).resolves.toBe("ok");
      const [url, init] = fetchMock.mock.calls[0]!;
      expect(String(url).startsWith(plan.baseUrl.replace(/\/$/, ""))).toBe(true);
      expect(String(url)).toMatch(
        plan.validation.kind === "models" ? /\/v1\/models$/ : /\/v1\/messages$/,
      );
      expect(String(url)).not.toContain("opencode");
      expect((init?.headers as Record<string, string> | undefined)?.["x-api-key"]).toBe(KEY);
    },
  );

  it("maps provider responses to user-facing outcomes", async () => {
    const plan = findCodingPlan("zai-coding-plan")!;
    const check = (response: Response | Error) =>
      validateCodingPlanKey(plan, KEY, {
        fetch: async () => {
          if (response instanceof Error) throw response;
          return response;
        },
      });
    await expect(check(json(401, { error: { code: "1000", message: "bad" } }))).resolves.toBe(
      "invalid_key",
    );
    await expect(check(json(429, { error: { code: "1113", message: "balance" } }))).resolves.toBe(
      "plan_inactive",
    );
    await expect(check(new TypeError("fetch failed"))).resolves.toBe("network");
    await expect(check(json(503, {}))).resolves.toBe("network");
    const minimax = findCodingPlan("minimax-coding-plan")!;
    await expect(
      validateCodingPlanKey(minimax, KEY, {
        fetch: async () => json(200, { base_resp: { status_code: 2049 } }),
      }),
    ).resolves.toBe("invalid_key");
  });
});

describe("makeCodingPlans", () => {
  it("stores a validated key, masks it, lists its Claude Code models, and disconnects", async () => {
    const { store, values } = memoryStore();
    const logs = [vi.spyOn(console, "log"), vi.spyOn(console, "info"), vi.spyOn(console, "warn")];
    const plans = makeCodingPlans(store, {
      fetch: async () => json(200, {}),
      openCodeAuthFilePath: join(await tempRoot(), "missing-auth.json"),
    });

    const result = await Effect.runPromise(
      plans.connect({ planId: "zai-coding-plan", apiKey: KEY }),
    );
    expect(result).toEqual({ planId: "zai-coding-plan", connected: true, keyHint: "1234" });
    expect(new TextDecoder().decode(values.get(codingPlanSecretName("zai-coding-plan")))).toBe(KEY);

    const listed = await Effect.runPromise(plans.list);
    expect(JSON.stringify(listed)).not.toContain(KEY);
    expect(listed.plans.find((plan) => plan.planId === "zai-coding-plan")).toMatchObject({
      connected: true,
      keyHint: "1234",
    });

    const models = await plans.connectedModels();
    expect(models.map((model) => model.slug)).toEqual([
      "plan/zai-coding-plan/glm-5.3",
      "plan/zai-coding-plan/glm-5.3-flash",
    ]);
    expect(models.every((model) => model.upstreamProviderName === "Z.AI Coding Plan")).toBe(true);

    await Effect.runPromise(plans.disconnect({ planId: "zai-coding-plan" }));
    expect(values.size).toBe(0);
    expect(await plans.connectedModels()).toEqual([]);
    for (const spy of logs)
      for (const call of spy.mock.calls) expect(JSON.stringify(call)).not.toContain(KEY);
  });

  it("does not save a key the provider rejects", async () => {
    const { store, values } = memoryStore();
    const plans = makeCodingPlans(store, {
      fetch: async () => json(401, { error: { message: "invalid" } }),
    });
    await expect(
      Effect.runPromise(plans.connect({ planId: "kimi-for-coding", apiKey: KEY })),
    ).resolves.toEqual({ planId: "kimi-for-coding", connected: false, error: "invalid_key" });
    expect(values.size).toBe(0);
  });

  it("imports an OpenCode plan key without modifying OpenCode's auth file", async () => {
    const authFile = join(await tempRoot(), "auth.json");
    const original = `${JSON.stringify({
      "zai-coding-plan": { type: "api", key: KEY },
      "github-copilot": { type: "oauth", refresh: "r", access: "a", expires: 1 },
    })}\n`;
    await writeFile(authFile, original, { mode: 0o600 });
    const before = await stat(authFile);
    const { store } = memoryStore();
    const plans = makeCodingPlans(store, {
      fetch: async () => json(200, {}),
      openCodeAuthFilePath: authFile,
    });

    const listed = await Effect.runPromise(plans.list);
    expect(
      listed.plans.find((plan) => plan.planId === "zai-coding-plan")?.openCodeKeyAvailable,
    ).toBe(true);
    expect(
      listed.plans.find((plan) => plan.planId === "kimi-for-coding")?.openCodeKeyAvailable,
    ).toBe(false);
    await expect(
      Effect.runPromise(plans.importFromOpenCode({ planId: "zai-coding-plan" })),
    ).resolves.toMatchObject({ connected: true });
    await expect(
      Effect.runPromise(plans.importFromOpenCode({ planId: "minimax-coding-plan" })),
    ).resolves.toMatchObject({ connected: false, error: "no_opencode_key" });

    const after = await stat(authFile);
    expect(await readFile(authFile, "utf8")).toBe(original);
    expect(after.mtimeMs).toBe(before.mtimeMs);
    expect(after.mode).toBe(before.mode);
    await expect(readOpenCodePlanKey("github-copilot", authFile)).resolves.toBeNull();
  });
});
