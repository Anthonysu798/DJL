import { describe, expect, it, vi } from "vitest";

import {
  buildInstallPingPayload,
  createInstallRecord,
  normalizeStatsUrl,
  parseInstallRecord,
  reportInstallOnce,
  resolveInstallRecordPath,
  resolveStatsUrl,
  serializeInstallRecord,
  type InstallPingDependencies,
  type InstallRecord,
} from "./installPing";

const NOW = new Date("2026-09-02T15:04:05.000Z");
const RECORD: InstallRecord = {
  schemaVersion: 1,
  installId: "6f1c2c0e-2b3a-4c4d-9e8f-0a1b2c3d4e5f",
  createdAt: "2026-09-01T00:00:00.000Z",
  reportedAt: null,
};
const RUNTIME = { version: "0.5.6", platform: "darwin", arch: "arm64", channel: "djl" } as const;
const RECORD_PATH = "/userData/install-record.json";

describe("resolveInstallRecordPath", () => {
  it("places the record inside userData", () => {
    expect(resolveInstallRecordPath("/Users/me/Library/Application Support/djl")).toBe(
      "/Users/me/Library/Application Support/djl/install-record.json",
    );
  });
});

describe("parseInstallRecord", () => {
  it("round-trips a serialized record", () => {
    expect(parseInstallRecord(serializeInstallRecord(RECORD))).toEqual(RECORD);
  });

  it("returns null for missing, corrupt, or misshapen files", () => {
    expect(parseInstallRecord(null)).toBeNull();
    expect(parseInstallRecord("{nope")).toBeNull();
    expect(parseInstallRecord(JSON.stringify({ schemaVersion: 1, installId: "x" }))).toBeNull();
    expect(parseInstallRecord(JSON.stringify({ ...RECORD, schemaVersion: 2 }))).toBeNull();
  });
});

describe("createInstallRecord", () => {
  it("generates a UUID and an unreported state", () => {
    const record = createInstallRecord(NOW);
    expect(record.installId).toMatch(/^[0-9a-f-]{36}$/);
    expect(record.createdAt).toBe(NOW.toISOString());
    expect(record.reportedAt).toBeNull();
  });
});

describe("buildInstallPingPayload", () => {
  it("contains exactly the disclosed fields", () => {
    expect(buildInstallPingPayload(RECORD, RUNTIME)).toEqual({
      installId: RECORD.installId,
      version: "0.5.6",
      platform: "darwin",
      arch: "arm64",
      channel: "djl",
    });
  });
});

describe("normalizeStatsUrl and resolveStatsUrl", () => {
  it("accepts only clean https URLs", () => {
    expect(normalizeStatsUrl("https://djl-stats.example.workers.dev/")).toBe(
      "https://djl-stats.example.workers.dev",
    );
    expect(normalizeStatsUrl("http://djl-stats.example.workers.dev")).toBeNull();
    expect(normalizeStatsUrl("https://user:pw@stats.example")).toBeNull();
    expect(normalizeStatsUrl("https://stats.example/?x=1")).toBeNull();
    expect(normalizeStatsUrl(42)).toBeNull();
  });

  it("prefers the environment over package metadata", () => {
    expect(
      resolveStatsUrl(
        { DJL_STATS_URL: "https://env.example" },
        { djlStatsUrl: "https://pkg.example" },
      ),
    ).toBe("https://env.example");
    expect(resolveStatsUrl({}, { djlStatsUrl: "https://pkg.example" })).toBe("https://pkg.example");
    expect(resolveStatsUrl({}, null)).toBeNull();
  });
});

describe("reportInstallOnce", () => {
  function setup(
    overrides: Partial<InstallPingDependencies> = {},
    files = new Map<string, string>(),
  ) {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    const deps: InstallPingDependencies = {
      recordPath: RECORD_PATH,
      statsUrl: "https://stats.djl.test",
      runtime: RUNTIME,
      readFile: (path) => files.get(path) ?? null,
      writeFile: (path, contents) => {
        files.set(path, contents);
      },
      fetch: fetchMock as unknown as typeof fetch,
      now: () => NOW,
      warn: vi.fn(),
      ...overrides,
    };
    return { files, deps, fetchMock: deps.fetch as unknown as typeof fetchMock };
  }

  it("creates a record, posts it, and stamps reportedAt on success", async () => {
    const { files, deps, fetchMock } = setup();

    await expect(reportInstallOnce(deps)).resolves.toBe("reported");

    const stored = parseInstallRecord(files.get(RECORD_PATH) ?? null);
    expect(stored?.reportedAt).toBe(NOW.toISOString());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://stats.djl.test/v1/installs");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      installId: stored?.installId,
      version: "0.5.6",
      platform: "darwin",
      arch: "arm64",
      channel: "djl",
    });
  });

  it("does nothing once the record is marked reported", async () => {
    const files = new Map([
      [RECORD_PATH, serializeInstallRecord({ ...RECORD, reportedAt: "2026-09-01T00:00:00.000Z" })],
    ]);
    const { deps, fetchMock } = setup({}, files);

    await expect(reportInstallOnce(deps)).resolves.toBe("already-reported");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps the same id and defers when the worker is unreachable", async () => {
    const files = new Map([[RECORD_PATH, serializeInstallRecord(RECORD)]]);
    const { deps } = setup(
      {
        fetch: vi.fn(async () => {
          throw new Error("offline");
        }) as unknown as typeof fetch,
      },
      files,
    );

    await expect(reportInstallOnce(deps)).resolves.toBe("deferred");
    expect(parseInstallRecord(files.get(RECORD_PATH) ?? null)).toEqual(RECORD);
    expect(deps.warn).toHaveBeenCalled();
  });

  it("defers on a non-2xx response", async () => {
    const { deps } = setup({
      fetch: vi.fn(async () => new Response(null, { status: 500 })) as unknown as typeof fetch,
    });

    await expect(reportInstallOnce(deps)).resolves.toBe("deferred");
  });

  it("never throws even when the record cannot be written", async () => {
    const { deps, fetchMock } = setup({
      writeFile: () => {
        throw new Error("read-only");
      },
    });

    await expect(reportInstallOnce(deps)).resolves.toBe("deferred");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
