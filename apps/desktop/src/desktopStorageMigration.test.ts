import * as FS from "node:fs";
import * as OS from "node:os";
import * as Path from "node:path";

import { describe, expect, it } from "vitest";

import {
  acknowledgeDjlStorageSnapshot,
  readDjlStorageSnapshot,
  resolveDjlStorageSnapshotPath,
  saveDjlStorageSnapshot,
  DJL_STORAGE_SNAPSHOT_MAX_BYTES,
  validateDjlStorageSnapshot,
} from "./desktopStorageMigration";

const snapshot = (exportedAt = "2026-07-09T00:00:00.000Z") => ({
  version: 1 as const,
  exportedAt,
  entries: {
    "djl:theme": "dark",
    "djl.openUsage.enabled": "true",
  },
});

describe("desktopStorageMigration", () => {
  it("uses the DJL snapshot filename for new profiles", () => {
    const userDataPath = Path.resolve("test-user-data");
    expect(resolveDjlStorageSnapshotPath(userDataPath)).toBe(
      Path.join(userDataPath, "djl-storage-origin-v1.json"),
    );
  });

  it("accepts DJL storage keys", () => {
    expect(
      validateDjlStorageSnapshot({
        ...snapshot(),
        entries: { "djl:theme": "dark", "djl.editor.fontSize": "14" },
      }),
    ).not.toBeNull();
  });

  it("round-trips atomically and acknowledges the snapshot", async () => {
    const directory = FS.mkdtempSync(Path.join(OS.tmpdir(), "djl-storage-migration-"));
    const target = Path.join(directory, "snapshot.json");
    try {
      await expect(saveDjlStorageSnapshot(target, snapshot())).resolves.toBe(true);
      expect(readDjlStorageSnapshot(target)).toEqual(snapshot());
      expect(FS.readdirSync(directory)).toEqual(["snapshot.json"]);

      await acknowledgeDjlStorageSnapshot(target);
      expect(readDjlStorageSnapshot(target)).toBeNull();
    } finally {
      FS.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects malformed, disallowed, and oversized snapshots", () => {
    expect(validateDjlStorageSnapshot({ version: 1 })).toBeNull();
    expect(
      validateDjlStorageSnapshot({
        ...snapshot(),
        entries: { "foreign:theme": "dark" },
      }),
    ).toBeNull();
    expect(
      validateDjlStorageSnapshot({
        ...snapshot(),
        entries: { "djl:large": "x".repeat(DJL_STORAGE_SNAPSHOT_MAX_BYTES) },
      }),
    ).toBeNull();
  });

  it("accepts renderer snapshots containing large composer drafts", () => {
    const largeDraft = "x".repeat(2 * 1024 * 1024);

    expect(
      validateDjlStorageSnapshot({
        ...snapshot(),
        entries: { "djl:composer-drafts:v1": largeDraft },
      })?.entries["djl:composer-drafts:v1"],
    ).toBe(largeDraft);
  });

  it("does not replace a newer snapshot with an older export", async () => {
    const directory = FS.mkdtempSync(Path.join(OS.tmpdir(), "djl-storage-migration-"));
    const target = Path.join(directory, "snapshot.json");
    try {
      await saveDjlStorageSnapshot(target, snapshot("2026-07-09T01:00:00.000Z"));
      await expect(
        saveDjlStorageSnapshot(target, snapshot("2026-07-09T00:00:00.000Z")),
      ).resolves.toBe(false);
      expect(readDjlStorageSnapshot(target)?.exportedAt).toBe("2026-07-09T01:00:00.000Z");
    } finally {
      FS.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("treats missing and malformed files as absent", () => {
    const directory = FS.mkdtempSync(Path.join(OS.tmpdir(), "djl-storage-migration-"));
    const target = Path.join(directory, "snapshot.json");
    try {
      expect(readDjlStorageSnapshot(target)).toBeNull();
      FS.writeFileSync(target, "not json");
      expect(readDjlStorageSnapshot(target)).toBeNull();
    } finally {
      FS.rmSync(directory, { recursive: true, force: true });
    }
  });
});
