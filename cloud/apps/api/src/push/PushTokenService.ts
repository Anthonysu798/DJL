/**
 * APNs device tokens for task-finished pushes. A token belongs to whoever
 * registered it last: when a phone signs in as someone else, the token moves
 * so the previous account stops receiving its notifications.
 */
import { and, eq } from "drizzle-orm";
import { schema, type DjlDatabase } from "@djl/db";
import type { CloudPushTokenInput } from "@synara/contracts/cloud";

import type { Principal } from "../auth/guard.ts";
import { ApiError } from "../http/errors.ts";

export class PushTokenService {
  constructor(private readonly db: DjlDatabase) {}

  async register(p: Principal, input: CloudPushTokenInput): Promise<void> {
    const token = input.token.toLowerCase();
    const deviceId = input.deviceId ?? null;
    if (deviceId) {
      // A device id must be one of the caller's own devices.
      const device = await this.db.query.devices.findFirst({
        columns: { id: true },
        where: and(eq(schema.devices.id, deviceId), eq(schema.devices.userId, p.userId)),
      });
      if (!device) throw new ApiError(404, "not_found", "Not found.");
    }
    const now = new Date();
    await this.db
      .insert(schema.pushTokens)
      .values({ userId: p.userId, deviceId, token, environment: input.environment })
      .onConflictDoUpdate({
        target: schema.pushTokens.token,
        set: {
          userId: p.userId,
          deviceId,
          environment: input.environment,
          lastSeenAt: now,
          revokedAt: null,
        },
      });
  }
}
