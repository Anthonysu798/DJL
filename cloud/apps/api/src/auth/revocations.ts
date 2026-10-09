/**
 * Revoked-session denylist. Access tokens are verified locally, so deleting a
 * session row alone would leave its JWTs valid until they expire; every
 * revoked session id is kept here for longer than an access token lives.
 */
import type { Redis } from "ioredis";

/** Access tokens live 15 minutes; keep the denial a little longer to cover clock skew. */
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
const DENY_TTL_SECONDS = ACCESS_TOKEN_TTL_SECONDS + 5 * 60;
const key = (sessionId: string) => `auth:revoked-session:${sessionId}`;

export interface SessionRevocations {
  readonly revoke: (sessionIds: readonly string[]) => Promise<void>;
  readonly isRevoked: (sessionId: string) => Promise<boolean>;
}

export function createSessionRevocations(redis: Redis): SessionRevocations {
  return {
    async revoke(sessionIds) {
      if (sessionIds.length === 0) return;
      const pipeline = redis.pipeline();
      for (const id of sessionIds) pipeline.set(key(id), "1", "EX", DENY_TTL_SECONDS);
      await pipeline.exec();
    },
    async isRevoked(sessionId) {
      return (await redis.exists(key(sessionId))) === 1;
    },
  };
}
