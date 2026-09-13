/**
 * Sliding-window request limits and concurrency holds. Redis in production
 * (shared across instances); an in-memory implementation for tests.
 * Keys never contain raw IPs; callers pass hashes.
 */
import type { Redis } from "ioredis";

export interface RateLimiter {
  /** Returns true when the request is allowed; consumes one unit. */
  readonly hit: (
    key: string,
    limit: number,
    windowSeconds: number,
  ) => Promise<{ allowed: boolean; remaining: number; retryAfterSeconds: number }>;
  /** Acquire a concurrency slot; release with the returned function. */
  readonly acquire: (
    key: string,
    limit: number,
    ttlSeconds: number,
  ) => Promise<{ acquired: boolean; release: () => Promise<void> }>;
  /** Clears all counters and holds for a key prefix (admin reset). */
  readonly reset: (prefix: string) => Promise<number>;
  readonly inFlight: (key: string) => Promise<number>;
}

const HIT_SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
redis.call('ZREMRANGEBYSCORE', key, 0, now - window * 1000)
local count = redis.call('ZCARD', key)
if count >= limit then
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  local retry = window - math.floor((now - tonumber(oldest[2])) / 1000)
  return {0, 0, retry}
end
redis.call('ZADD', key, now, now .. '-' .. math.random(1000000))
redis.call('PEXPIRE', key, window * 1000)
return {1, limit - count - 1, 0}
`;

export function createRedisRateLimiter(redis: Redis): RateLimiter {
  return {
    async hit(key, limit, windowSeconds) {
      const [allowed, remaining, retry] = (await redis.eval(
        HIT_SCRIPT,
        1,
        `rl:${key}`,
        Date.now(),
        windowSeconds,
        limit,
      )) as [number, number, number];
      return { allowed: allowed === 1, remaining, retryAfterSeconds: retry };
    },
    async acquire(key, limit, ttlSeconds) {
      const slot = `cc:${key}`;
      const id = crypto.randomUUID();
      const now = Date.now();
      await redis.zremrangebyscore(slot, 0, now - ttlSeconds * 1000);
      const count = await redis.zcard(slot);
      if (count >= limit) return { acquired: false, release: async () => {} };
      await redis.zadd(slot, now, id);
      await redis.expire(slot, ttlSeconds);
      return {
        acquired: true,
        release: async () => {
          await redis.zrem(slot, id);
        },
      };
    },
    async reset(prefix) {
      let cursor = "0";
      let removed = 0;
      do {
        const [next, keys] = await redis.scan(cursor, "MATCH", `*:${prefix}*`, "COUNT", 200);
        cursor = next;
        if (keys.length) removed += await redis.del(...keys);
      } while (cursor !== "0");
      return removed;
    },
    async inFlight(key) {
      return redis.zcard(`cc:${key}`);
    },
  };
}

export function createMemoryRateLimiter(now: () => number = Date.now): RateLimiter {
  const hits = new Map<string, number[]>();
  const holds = new Map<string, Map<string, number>>();
  return {
    async hit(key, limit, windowSeconds) {
      const t = now();
      const arr = (hits.get(key) ?? []).filter((x) => t - x < windowSeconds * 1000);
      if (arr.length >= limit) {
        hits.set(key, arr);
        return {
          allowed: false,
          remaining: 0,
          retryAfterSeconds: Math.max(1, windowSeconds - Math.floor((t - arr[0]!) / 1000)),
        };
      }
      arr.push(t);
      hits.set(key, arr);
      return { allowed: true, remaining: limit - arr.length, retryAfterSeconds: 0 };
    },
    async acquire(key, limit, ttlSeconds) {
      const t = now();
      const map = holds.get(key) ?? new Map<string, number>();
      for (const [id, at] of map) if (t - at > ttlSeconds * 1000) map.delete(id);
      holds.set(key, map);
      if (map.size >= limit) return { acquired: false, release: async () => {} };
      const id = crypto.randomUUID();
      map.set(id, t);
      return {
        acquired: true,
        release: async () => {
          map.delete(id);
        },
      };
    },
    async reset(prefix) {
      let n = 0;
      for (const k of Array.from(hits.keys())) {
        if (k.includes(prefix)) {
          hits.delete(k);
          n += 1;
        }
      }
      for (const k of Array.from(holds.keys())) {
        if (k.includes(prefix)) {
          holds.delete(k);
          n += 1;
        }
      }
      return n;
    },
    async inFlight(key) {
      return holds.get(key)?.size ?? 0;
    },
  };
}
