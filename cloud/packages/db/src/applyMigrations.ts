import { readMigrationFiles } from "drizzle-orm/migrator";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import type { Sql } from "postgres";

const firstShopMigration = 1792965600000;
const legacySocialTimes = new Map([
  [1794578400001, 1792008003000], // Social connections
  [1794578400002, 1792008004000], // Publishing
  [1794578400003, 1792008005000], // Reviews
  [1794578400004, 1792008006000], // Reports
  [1794578400005, 1792008007000], // Tracking
  [1794578400006, 1794578400000], // FCM installations
]);
const lastCombinedMigration = 1794578400006;

export async function applyCloudMigrations(client: Sql, migrationsFolder: string): Promise<void> {
  const config = { migrationsFolder };
  const migrations = readMigrationFiles(config);

  // A database migrated from the social branch can already have a receipt newer
  // than the Shop series. Drizzle's timestamp high-water mark skips those Shop
  // migrations. Fill only that fork's gap before continuing normal migration.
  await client.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(114571987, 46)`;
    const [journal] = await tx<{ ready: boolean }[]>`
      SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS ready
    `;
    if (!journal?.ready) return;

    const receipts = await tx<{ hash: string; created_at: string }[]>`
      SELECT hash, created_at FROM drizzle.__drizzle_migrations
    `;
    const byTime = new Map(receipts.map((receipt) => [Number(receipt.created_at), receipt.hash]));
    if (![...legacySocialTimes.values()].some((time) => byTime.has(time))) return;

    for (const migration of migrations) {
      const time = migration.folderMillis;
      if (time < firstShopMigration || time > lastCombinedMigration) continue;
      const canonical = byTime.get(time);
      if (canonical !== undefined) {
        if (canonical !== migration.hash)
          throw new Error("Combined migration receipt does not match source");
        continue;
      }
      const legacyTime = legacySocialTimes.get(time);
      const legacy = legacyTime === undefined ? undefined : byTime.get(legacyTime);
      if (legacy !== undefined && legacy !== migration.hash)
        throw new Error("Legacy social migration receipt does not match source");
      if (legacy === undefined) {
        for (const statement of migration.sql) await tx.unsafe(statement);
      }
      await tx`
        INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
        VALUES (${migration.hash}, ${time})
      `;
    }
  });

  await migrate(drizzle(client), config);
}
