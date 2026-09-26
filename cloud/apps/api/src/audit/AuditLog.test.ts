import { desc, eq } from "drizzle-orm";
import { schema } from "@djl/db";
import { afterAll, describe, expect, it } from "vitest";

import { testDatabase } from "../testing/db.ts";
import { writeAudit } from "./AuditLog.ts";

const conn = testDatabase();
afterAll(() => conn.close());

describe("audit log", () => {
  it("records bigint values (microcredits) as decimal strings instead of failing", async () => {
    const targetId = `plan-${crypto.randomUUID()}`;
    await writeAudit(conn.db, {
      actorType: "admin",
      actorId: "admin-1",
      action: "admin.plan.update",
      targetType: "plan",
      targetId,
      before: { window5hMicro: 10_000_000n, nested: [{ cap: 1n }] },
      after: { window5hMicro: 1_000_000n },
    });
    const [row] = await conn.db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.targetId, targetId))
      .orderBy(desc(schema.auditEvents.createdAt));
    expect(row?.before).toEqual({ window5hMicro: "10000000", nested: [{ cap: "1" }] });
    expect(row?.after).toEqual({ window5hMicro: "1000000" });
  });
});
