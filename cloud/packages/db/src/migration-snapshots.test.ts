import { readdir, readFile } from "node:fs/promises";
import { expect, it } from "vitest";

const migrations = new URL("../drizzle/", import.meta.url);
const meta = new URL("meta/", migrations);

it("keeps one linked Drizzle snapshot for each SQL migration", async () => {
  const journal = JSON.parse(await readFile(new URL("_journal.json", meta), "utf8")) as {
    version: string;
    dialect: string;
    entries: { idx: number; tag: string }[];
  };
  const snapshots = journal.entries.map(
    ({ idx }) => `${String(idx).padStart(4, "0")}_snapshot.json`,
  );
  expect((await readdir(migrations)).filter((name) => name.endsWith(".sql")).toSorted()).toEqual(
    journal.entries.map(({ tag }) => `${tag}.sql`),
  );
  expect(
    (await readdir(meta)).filter((name) => name.endsWith("_snapshot.json")).toSorted(),
  ).toEqual(snapshots);

  let previous = "00000000-0000-0000-0000-000000000000";
  const seen = new Set([previous]);
  for (const [index, name] of snapshots.entries()) {
    const snapshot = JSON.parse(await readFile(new URL(name, meta), "utf8")) as {
      id: string;
      prevId: string;
      version: string;
      dialect: string;
    };
    expect(journal.entries[index]?.tag.slice(0, 4)).toBe(name.slice(0, 4));
    expect(snapshot).toMatchObject({
      prevId: previous,
      version: journal.version,
      dialect: journal.dialect,
    });
    expect(seen.has(snapshot.id)).toBe(false);
    seen.add(snapshot.id);
    previous = snapshot.id;
  }
});
