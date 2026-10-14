import { and, desc, eq, gt } from "drizzle-orm";
import { schema, type DjlDatabase } from "@djl/db";
import type { CloudRegisterDeviceInput } from "@synara/contracts/cloud";

import type { Principal } from "../auth/guard.ts";
import { ApiError } from "../http/errors.ts";

/** Reuse an install identity and bind it to this user's authenticated session. */
export async function registerSessionDevice(
  db: DjlDatabase,
  p: Principal,
  input: CloudRegisterDeviceInput,
) {
  return db.transaction(async (tx) => {
    // Serialize registrations for this user so two tabs cannot create duplicate installs.
    await tx
      .select({ id: schema.user.id })
      .from(schema.user)
      .where(eq(schema.user.id, p.userId))
      .for("update");
    const login = await tx.query.session.findFirst({
      where: and(eq(schema.session.id, p.sessionId), eq(schema.session.userId, p.userId)),
    });
    if (!login)
      throw new ApiError(401, "session_required", "Sign in again to register this device.");
    const existing = await tx.query.devices.findFirst({
      where: and(
        eq(schema.devices.userId, p.userId),
        eq(schema.devices.fingerprint, input.fingerprint),
      ),
      orderBy: [desc(schema.devices.createdAt)],
    });
    if (existing?.trustState === "revoked")
      throw new ApiError(403, "device_revoked", "This device has been revoked.");
    const now = new Date();
    const values = {
      name: input.name ?? existing?.name ?? null,
      publicKey: input.publicKey ?? existing?.publicKey ?? null,
      appVersion: input.appVersion ?? existing?.appVersion ?? null,
      platform: input.platform ?? existing?.platform ?? null,
      lastSeenAt: now,
    };
    const [device] = existing
      ? await tx
          .update(schema.devices)
          .set(values)
          .where(eq(schema.devices.id, existing.id))
          .returning({
            id: schema.devices.id,
            kind: schema.devices.kind,
            syncEnabled: schema.devices.syncEnabled,
          })
      : await tx
          .insert(schema.devices)
          .values({ userId: p.userId, kind: input.kind, fingerprint: input.fingerprint, ...values })
          .returning({
            id: schema.devices.id,
            kind: schema.devices.kind,
            syncEnabled: schema.devices.syncEnabled,
          });
    // Preserve the auth refresh timestamp; changing it would defer Better Auth's session renewal.
    await tx
      .update(schema.session)
      .set({ deviceId: device!.id, updatedAt: login.updatedAt })
      .where(eq(schema.session.id, login.id));
    return device!;
  });
}

export async function listDeviceSessions(db: DjlDatabase, p: Principal) {
  const rows = await db
    .select({
      id: schema.session.id,
      deviceId: schema.devices.id,
      kind: schema.devices.kind,
      name: schema.devices.name,
      platform: schema.devices.platform,
      ipAddress: schema.session.ipAddress,
      userAgent: schema.session.userAgent,
      createdAt: schema.session.createdAt,
      updatedAt: schema.session.updatedAt,
      lastSeenAt: schema.devices.lastSeenAt,
      expiresAt: schema.session.expiresAt,
    })
    .from(schema.session)
    .leftJoin(
      schema.devices,
      and(eq(schema.session.deviceId, schema.devices.id), eq(schema.devices.userId, p.userId)),
    )
    .where(and(eq(schema.session.userId, p.userId), gt(schema.session.expiresAt, new Date())))
    .orderBy(desc(schema.session.createdAt));
  return rows.map((row) => ({
    id: row.id,
    deviceId: row.deviceId,
    kind: row.kind,
    name: row.name,
    platform: row.platform,
    ipAddress: row.ipAddress,
    userAgent: row.userAgent,
    createdAt: row.createdAt.toISOString(),
    lastSeenAt: new Date(
      Math.max(row.lastSeenAt?.getTime() ?? 0, row.updatedAt.getTime()),
    ).toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    current: row.id === p.sessionId,
  }));
}
