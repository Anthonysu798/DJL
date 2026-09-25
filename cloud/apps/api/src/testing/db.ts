/**
 * Test database helpers. Tests run against the CI/service Postgres at
 * DATABASE_URL (docker compose locally, service container in CI). Each test
 * file creates its own organization ids so files can run in parallel.
 */
import { createDatabase, schema } from "@djl/db";

export function testDatabase() {
  const url = process.env.DATABASE_URL ?? "postgres://djl:djl@localhost:54329/djl";
  return createDatabase(url, { max: 4 });
}

/** Insert a minimal user + organization pair and return the ids. */
export async function seedOrg(db: ReturnType<typeof testDatabase>["db"], label = "test") {
  const suffix = crypto.randomUUID().slice(0, 8);
  const [user] = await db
    .insert(schema.user)
    .values({
      name: `${label}-${suffix}`,
      email: `${label}-${suffix}@test.invalid`,
      emailVerified: true,
    })
    .returning();
  const [org] = await db
    .insert(schema.organization)
    .values({ name: `${label}-${suffix}`, slug: `${label}-${suffix}`, createdAt: new Date() })
    .returning();
  await db
    .insert(schema.member)
    .values({ organizationId: org!.id, userId: user!.id, role: "owner", createdAt: new Date() });
  return { userId: user!.id, orgId: org!.id };
}
