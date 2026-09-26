import { Redis } from "ioredis";
import { afterAll, describe, expect, it } from "vitest";

import {
  createMemoryRateLimiter,
  createRedisRateLimiter,
  type RateLimiter,
} from "./RateLimiter.ts";

const redisUrl = process.env.REDIS_URL;
const redis = redisUrl ? new Redis(redisUrl, { maxRetriesPerRequest: 2 }) : null;
afterAll(() => redis?.disconnect());

const limiters: [string, (() => RateLimiter) | null][] = [
  ["memory", () => createMemoryRateLimiter()],
  ["redis", redis ? () => createRedisRateLimiter(redis) : null],
];

describe.each(limiters)("%s rate limiter acquire", (_name, make) => {
  it.skipIf(!make)("never admits more than the limit under concurrent acquires", async () => {
    const limiter = make!();
    const key = `test:acquire:${crypto.randomUUID()}`;
    for (let round = 0; round < 5; round += 1) {
      const holds = await Promise.all(
        Array.from({ length: 60 }, () => limiter.acquire(key, 5, 60)),
      );
      expect(holds.filter((h) => h.acquired)).toHaveLength(5);
      expect(await limiter.inFlight(key)).toBe(5);
      await Promise.all(holds.map((h) => h.release()));
      expect(await limiter.inFlight(key)).toBe(0);
    }
  });

  it.skipIf(!make)("frees a slot on release and expires stale holds after the TTL", async () => {
    const limiter = make!();
    const key = `test:acquire:${crypto.randomUUID()}`;
    const a = await limiter.acquire(key, 1, 1);
    expect(a.acquired).toBe(true);
    expect((await limiter.acquire(key, 1, 1)).acquired).toBe(false);
    await a.release();
    const b = await limiter.acquire(key, 1, 1);
    expect(b.acquired).toBe(true);
    await new Promise((r) => setTimeout(r, 1_050));
    expect((await limiter.acquire(key, 1, 1)).acquired).toBe(true);
  });
});
