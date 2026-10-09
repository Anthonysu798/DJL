import { describe, expect, it, vi } from "vitest";
import { prewarmThreadRoute } from "./prewarmThreadRoute";

describe("prewarmThreadRoute", () => {
  it("loads the thread route chunk once the router exists", () => {
    const route = { id: "/_chat/$threadId" };
    const loadRouteChunk = vi.fn(async () => undefined);
    prewarmThreadRoute({ routesById: { "/_chat/$threadId": route }, loadRouteChunk });
    expect(loadRouteChunk).toHaveBeenCalledWith(route);
  });

  it("ignores a missing route and chunk load failures", async () => {
    const loadRouteChunk = vi.fn(() => Promise.reject(new Error("offline")));
    expect(() => prewarmThreadRoute({ routesById: {}, loadRouteChunk })).not.toThrow();
    expect(loadRouteChunk).not.toHaveBeenCalled();
    expect(() =>
      prewarmThreadRoute({ routesById: { "/_chat/$threadId": {} }, loadRouteChunk }),
    ).not.toThrow();
    await Promise.resolve();
  });
});
