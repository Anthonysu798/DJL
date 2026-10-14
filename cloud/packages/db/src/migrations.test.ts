import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { expect, it } from "vitest";

const folder = new URL("../drizzle/", import.meta.url);
const journal = JSON.parse(await readFile(new URL("meta/_journal.json", folder), "utf8"));
type Entry = (typeof journal.entries)[number];
const base = journal.entries.slice(0, 5);
const legacy = journal.entries.slice(6, 9).map((entry: Entry, index: number) => ({
  ...entry,
  idx: index + 5,
  when: [1791776856415, 1791777168849, 1791780761906][index],
}));

for (const [name, entries] of [
  ["fresh database", []],
  ["PR41 account/device database", journal.entries.slice(0, 6)],
  ["PR42 notification/gallery database", [...base, ...legacy]],
  [
    "VPS with both branches already applied",
    [...base, ...legacy, { ...journal.entries[5], idx: 8 }],
  ],
] as const) {
  it(`upgrades ${name} without losing data and can run again`, async () => {
    const url = new URL(process.env.DATABASE_URL ?? "postgres://djl:djl@localhost:54329/djl");
    const admin = postgres(url.href, { max: 1 });
    const database = `djl_migrations_${randomUUID().replaceAll("-", "")}`;
    const temporary = await mkdtemp(join(tmpdir(), "djl-migrations-"));
    let client: ReturnType<typeof postgres> | undefined;
    try {
      await admin.unsafe(`CREATE DATABASE "${database}"`);
      url.pathname = `/${database}`;
      client = postgres(url.href, { max: 1, prepare: false });
      const db = drizzle(client);
      if (entries.length) {
        await mkdir(join(temporary, "meta"));
        await writeFile(
          join(temporary, "meta/_journal.json"),
          JSON.stringify({ ...journal, entries }),
        );
        for (const entry of entries) {
          await writeFile(
            join(temporary, `${entry.tag}.sql`),
            await readFile(new URL(`${entry.tag}.sql`, folder)),
          );
        }
        await migrate(db, { migrationsFolder: temporary });
      }
      const userId = randomUUID();
      if (entries.length) {
        await client`INSERT INTO "user" (id, name, email, created_at, updated_at) VALUES (${userId}, 'Migration QA', ${`${userId}@example.invalid`}, now(), now())`;
      }
      await migrate(db, { migrationsFolder: folder.pathname });
      await migrate(db, { migrationsFolder: folder.pathname });
      if (entries.length) {
        const [user] = await client`SELECT name FROM "user" WHERE id = ${userId}`;
        expect(user?.name).toBe("Migration QA");
      }
      const columns =
        await client`SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name IN ('device_id', 'message_id', 'image_aspect_ratio')`;
      expect(columns).toEqual(
        expect.arrayContaining([
          { table_name: "session", column_name: "device_id" },
          { table_name: "files", column_name: "message_id" },
          { table_name: "runs", column_name: "image_aspect_ratio" },
        ]),
      );
      const constraints =
        await client`SELECT conname FROM pg_constraint WHERE conrelid IN ('public.session'::regclass, 'public.files'::regclass, 'public.notification_reads'::regclass)`;
      expect(constraints.map((row) => row.conname)).toEqual(
        expect.arrayContaining([
          "session_device_id_devices_id_fk",
          "files_message_id_messages_id_fk",
          "notification_reads_user_id_user_id_fk",
          "notification_reads_org_id_organization_id_fk",
          "notification_reads_run_id_runs_id_fk",
        ]),
      );
      const indexes = await client`SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`;
      expect(indexes.map((row) => row.indexname)).toEqual(
        expect.arrayContaining(["runs_task_finished_idx", "files_generated_gallery_idx"]),
      );
    } finally {
      await client?.end();
      await admin.unsafe(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
      await admin.end();
      await rm(temporary, { recursive: true, force: true });
    }
  }, 30_000);
}
