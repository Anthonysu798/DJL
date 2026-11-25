/**
 * Redis-backed counters shared by every API instance: fixed-window request
 * throttles (Better Auth's rate-limit storage) and failure lockouts (admin
 * sign-in). Keys are hashed so no email or IP ever lands in Redis.
 */
import { createHash } from "node:crypto";

import type { Redis } from "ioredis";

/** INCR and start the window on the first hit, atomically; returns {count, ttlSeconds}. */
const CONSUME_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('TTL', KEYS[1])
if ttl < 0 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return {count, ttl}
`;

const hashed = (prefix: string, key: string) =>
  `${prefix}:${createHash("sha256").update(key).digest("base64url")}`;

async function incrementWindow(redis: Redis, key: string, windowSeconds: number) {
  const [count, ttl] = (await redis.eval(CONSUME_SCRIPT, 1, key, windowSeconds)) as [
    number,
    number,
  ];
  return { count, ttl };
}

export interface Throttle {
  /** Records one request; refuses once `max` requests landed in the current window. */
  readonly consume: (
    key: string,
    rule: { readonly window: number; readonly max: number },
  ) => Promise<{ allowed: boolean; retryAfter: number | null }>;
}

export function createRedisThrottle(redis: Redis, prefix: string): Throttle {
  return {
    async consume(key, rule) {
      const { count, ttl } = await incrementWindow(redis, hashed(prefix, key), rule.window);
      return count <= rule.max
        ? { allowed: true, retryAfter: null }
        : { allowed: false, retryAfter: ttl };
    },
  };
}

/** Count one attempt unless the key is already at its limit, atomically; returns 1 when counted. */
const RESERVE_SCRIPT = `
if tonumber(redis.call('GET', KEYS[1]) or '0') >= tonumber(ARGV[2]) then return 0 end
redis.call('INCR', KEYS[1])
if redis.call('TTL', KEYS[1]) < 0 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return 1
`;

/** Give one counted attempt back, never below zero. */
const RELEASE_SCRIPT = `
if tonumber(redis.call('GET', KEYS[1]) or '0') > 1 then return redis.call('DECR', KEYS[1]) end
return redis.call('DEL', KEYS[1])
`;

export interface Lockouts {
  readonly isLocked: (key: string) => Promise<boolean>;
  readonly noteFailure: (key: string) => Promise<void>;
  /**
   * Counts an attempt as a failure before it is checked, so parallel guesses
   * cannot all pass the limit first. False when the key is locked. `max`
   * overrides the configured limit for keys with their own cap.
   */
  readonly reserve: (key: string, max?: number) => Promise<boolean>;
  /** Takes back a reserved attempt that turned out not to be a failure. */
  readonly release: (key: string) => Promise<void>;
}

/** Locks a key after `maxFailures` failures inside `windowSeconds`; survives restarts. */
export function createRedisLockouts(
  redis: Redis,
  options: {
    readonly prefix: string;
    readonly maxFailures: number;
    readonly windowSeconds: number;
  },
): Lockouts {
  return {
    async isLocked(key) {
      const count = Number((await redis.get(hashed(options.prefix, key))) ?? 0);
      return count >= options.maxFailures;
    },
    async noteFailure(key) {
      await incrementWindow(redis, hashed(options.prefix, key), options.windowSeconds);
    },
    async reserve(key, max = options.maxFailures) {
      const counted = await redis.eval(
        RESERVE_SCRIPT,
        1,
        hashed(options.prefix, key),
        options.windowSeconds,
        max,
      );
      return counted === 1;
    },
    async release(key) {
      await redis.eval(RELEASE_SCRIPT, 1, hashed(options.prefix, key));
    },
  };
}
