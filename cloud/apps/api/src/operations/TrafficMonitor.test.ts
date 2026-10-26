import { Redis } from "ioredis";
import { describe, expect, it } from "vitest";
import { TrafficMonitor } from "./TrafficMonitor.ts";

describe("content-free traffic history", () => {
  it("records counters and weighted latency without request content", async () => {
    const redis = new Redis(process.env.REDIS_URL ?? "redis://127.0.0.1:63799");
    const at = 1_500_000_000_000 + Math.floor(Math.random() * 1_000_000) * 300_000;
    const monitor = new TrafficMonitor(redis, () => at);
    const key = "operations:traffic:" + Math.floor(at / 300_000) * 300;
    await redis.del(key);
    try {
      monitor.record(200, 20);
      monitor.record(503, 40);
      const data = await monitor.snapshot("hour");
      expect(data.requests).toBe(2);
      expect(data.errors).toBe(1);
      expect(data.averageLatencyMs).toBe(30);
      expect(Object.keys(await redis.hgetall(key)).toSorted()).toEqual([
        "errors",
        "latency",
        "requests",
      ]);
      expect(data.history.length).toBeLessThanOrEqual(121);
    } finally {
      await monitor.close();
      await redis.del(key);
      redis.disconnect();
    }
  });
});
