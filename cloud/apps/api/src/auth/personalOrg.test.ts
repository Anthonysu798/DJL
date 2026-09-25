import { eq } from "drizzle-orm";
import { schema } from "@djl/db";
import { afterAll, describe, expect, it } from "vitest";

import { testDatabase } from "../testing/db.ts";
import { createPersonalOrganization, PERSONAL_ORG_METADATA } from "./auth.ts";

const conn = testDatabase();
afterAll(() => conn.close());

describe("personal organization", () => {
  it("creates one personal org per user, idempotently, with a balances row", async () => {
    const [user] = await conn.db
      .insert(schema.user)
      .values({
        name: "P",
        email: `p-${crypto.randomUUID().slice(0, 8)}@test.invalid`,
        emailVerified: true,
      })
      .returning();
    await createPersonalOrganization(conn.db, user!.id, "P");
    await createPersonalOrganization(conn.db, user!.id, "P");
    const memberships = await conn.db.query.member.findMany({
      where: eq(schema.member.userId, user!.id),
    });
    expect(memberships).toHaveLength(1);
    expect(memberships[0]?.role).toBe("owner");
    const org = await conn.db.query.organization.findFirst({
      where: eq(schema.organization.id, memberships[0]!.organizationId),
    });
    expect(org?.metadata).toBe(PERSONAL_ORG_METADATA);
    const balances = await conn.db.query.creditBalances.findFirst({
      where: eq(schema.creditBalances.orgId, org!.id),
    });
    expect(balances?.plan).toBe(0n);
  });
});
