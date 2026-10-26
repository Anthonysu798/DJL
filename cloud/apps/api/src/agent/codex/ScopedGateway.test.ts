import { describe, expect, it, vi } from "vitest";
import { ScopedGateway } from "./ScopedGateway.ts";
import type { RequestFacts, StepOptions } from "../../gateway/GatewayService.ts";
import { containerArgs, createBroker } from "./broker.ts";

const facts = { principal: { userId: "user", orgId: "org" } } as RequestFacts;
const request = (token: string, body: unknown = { model: "bound", input: "hello" }) =>
  new Request("http://worker/v1/responses", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });

describe("scoped Codex inference", () => {
  it("rejects unknown, revoked, expired, and model-swapped credentials before inference", async () => {
    const upstream = vi.fn();
    const service = new ScopedGateway({ responsesStream: upstream });
    const input = {
      model: "bound",
      expiresAt: Date.now() + 1000,
      signal: new AbortController().signal,
      facts: async () => facts,
      beginStep: async () => {},
      settled: async () => {},
      budget: () => 100n,
    };
    const scope = service.open(input);
    expect((await service.handle(request("wrong"))).status).toBe(401);
    expect((await service.handle(request(scope.token, { model: "other" }))).status).toBe(403);
    scope.close();
    expect((await service.handle(request(scope.token))).status).toBe(401);
    const expired = service.open({ ...input, expiresAt: 0 });
    expect((await service.handle(request(expired.token))).status).toBe(401);
    expired.close();
    expect(upstream).not.toHaveBeenCalled();
  });
  it("prevents overlapping requests from bypassing the remaining run budget", async () => {
    let finish!: () => void;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        finish = () => controller.close();
      },
    });
    const upstream = vi.fn(
      async (_facts: RequestFacts, _body: unknown, _options?: StepOptions) => ({
        stream,
        requestId: "r",
      }),
    );
    const service = new ScopedGateway({ responsesStream: upstream });
    const scope = service.open({
      model: "bound",
      expiresAt: Date.now() + 1000,
      signal: new AbortController().signal,
      facts: async () => facts,
      beginStep: async () => {},
      settled: async () => {},
      budget: () => 15n,
    });
    const first = await service.handle(request(scope.token));
    expect((await service.handle(request(scope.token))).status).toBe(409);
    expect(upstream.mock.calls[0]?.[2]).toMatchObject({ budgetCap: 15n });
    finish();
    await first.text();
    scope.close();
  });
});

describe("isolated Codex broker", () => {
  it("launches non-root restricted containers without host mounts or upstream secrets", () => {
    const args = containerArgs(
      "00000000-0000-0000-0000-000000000001",
      "djl-codex:0.125.0",
      "djl-codex",
    );
    expect(args).toContain("--read-only");
    expect(args).toContain("no-new-privileges");
    expect(args).toContain("1000:1000");
    expect(args.join(" ")).not.toMatch(/docker\.sock|host|privileged|OPENROUTER|DATABASE_URL/);
    expect(() => containerArgs("../../other-user", "image", "network")).toThrow();
  });
  it("does not let task credentials reach the trusted controller", async () => {
    const broker = createBroker({
      token: "x".repeat(40),
      image: "djl-codex:0.125.0",
      network: "djl-codex",
      gatewayUrl: "http://worker:8081",
    });
    try {
      expect(
        (
          await broker.fetch(
            new Request("http://broker/runs/start", {
              method: "POST",
              headers: { authorization: "Bearer task-token" },
              body: "{}",
            }),
          )
        ).status,
      ).toBe(401);
      expect(
        (
          await broker.fetch(
            new Request("http://broker/v1/responses", {
              method: "POST",
              headers: { authorization: "Bearer task-token" },
              body: "{}",
            }),
          )
        ).status,
      ).toBe(401);
    } finally {
      await broker.close();
    }
  });
});
