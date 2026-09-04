import { describe, expect, it } from "vitest";

import { handleRequest, type Env } from "./index";

interface Executed {
  readonly sql: string;
  readonly args: readonly unknown[];
}

class FakeStatement {
  constructor(
    private readonly db: FakeD1,
    readonly sql: string,
    readonly args: readonly unknown[] = [],
  ) {}

  bind(...args: unknown[]): FakeStatement {
    return new FakeStatement(this.db, this.sql, args);
  }

  async run(): Promise<{ success: boolean }> {
    this.db.executed.push({ sql: this.sql, args: this.args });
    return { success: true };
  }
}

class FakeD1 {
  readonly executed: Executed[] = [];

  constructor(private readonly canned: ReadonlyArray<readonly [string, unknown[]]> = []) {}

  prepare(sql: string): FakeStatement {
    return new FakeStatement(this, sql);
  }

  async batch(statements: readonly FakeStatement[]): Promise<Array<{ results: unknown[] }>> {
    return statements.map((statement) => {
      this.executed.push({ sql: statement.sql, args: statement.args });
      const match = this.canned.find(([needle]) => statement.sql.includes(needle));
      return { results: match ? match[1] : [] };
    });
  }
}

const NOW = new Date("2026-09-02T15:04:05.000Z");
const INSTALL_ID = "6f1c2c0e-2b3a-4c4d-9e8f-0a1b2c3d4e5f";
const VISITOR_ID = "f4d1b4dc-3ff4-4fcf-89b8-658884d0be87";

function env(db: FakeD1, token?: string): Env {
  return { DB: db as unknown as D1Database, ...(token ? { STATS_READ_TOKEN: token } : {}) };
}

function post(path: string, body: unknown, cf?: { country: string }): Request {
  const request = new Request(`https://stats.djl.test${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return cf ? Object.assign(request, { cf }) : request;
}

describe("POST /v1/visits", () => {
  it("stores a normalized anonymous page view", async () => {
    const db = new FakeD1();
    const response = await handleRequest(
      post("/v1/visits", { visitorId: VISITOR_ID.toUpperCase(), path: "/guide", country: "ca" }),
      env(db),
      NOW,
    );

    expect(response.status).toBe(204);
    expect(db.executed).toEqual([
      {
        sql: expect.stringContaining("INSERT INTO visits"),
        args: [NOW.toISOString(), VISITOR_ID, "/guide", "CA"],
      },
    ]);
  });

  it("rejects unsafe paths without touching D1", async () => {
    const db = new FakeD1();
    const response = await handleRequest(
      post("/v1/visits", { visitorId: VISITOR_ID, path: "/guide?token=secret" }),
      env(db),
      NOW,
    );

    expect(response.status).toBe(400);
    expect(db.executed).toHaveLength(0);
  });
});

describe("POST /v1/downloads", () => {
  it("stores a valid event with the caller-supplied country", async () => {
    const db = new FakeD1();
    const response = await handleRequest(
      post("/v1/downloads", {
        platform: "mac",
        arch: "arm64",
        source: "oss",
        country: "CN",
        version: "0.5.6",
      }),
      env(db),
      NOW,
    );
    expect(response.status).toBe(204);
    expect(db.executed).toHaveLength(1);
    expect(db.executed[0]?.sql).toContain("INSERT INTO downloads");
    expect(db.executed[0]?.args).toEqual([NOW.toISOString(), "mac", "arm64", "oss", "CN", "0.5.6"]);
  });

  it("rejects an invalid event without touching the database", async () => {
    const db = new FakeD1();
    const response = await handleRequest(
      post("/v1/downloads", { platform: "linux", arch: "x64", source: "github" }),
      env(db),
      NOW,
    );
    expect(response.status).toBe(400);
    expect(db.executed).toHaveLength(0);
  });

  it("rejects malformed JSON and oversized bodies", async () => {
    const db = new FakeD1();
    const malformed = new Request("https://stats.djl.test/v1/downloads", {
      method: "POST",
      body: "{not json",
    });
    expect((await handleRequest(malformed, env(db), NOW)).status).toBe(400);
    const oversized = post("/v1/downloads", {
      platform: "mac",
      arch: "x64",
      source: "github",
      pad: "x".repeat(5000),
    });
    expect((await handleRequest(oversized, env(db), NOW)).status).toBe(400);
    expect(db.executed).toHaveLength(0);
  });
});

describe("POST /v1/installs", () => {
  it("stores the install keyed by id and takes the country from Cloudflare", async () => {
    const db = new FakeD1();
    const response = await handleRequest(
      post(
        "/v1/installs",
        {
          installId: INSTALL_ID,
          version: "0.5.6",
          platform: "darwin",
          arch: "arm64",
          channel: "djl",
        },
        { country: "CN" },
      ),
      env(db),
      NOW,
    );
    expect(response.status).toBe(204);
    expect(db.executed[0]?.sql).toContain("INSERT OR IGNORE INTO installs");
    expect(db.executed[0]?.args).toEqual([
      INSTALL_ID,
      NOW.toISOString(),
      "0.5.6",
      "darwin",
      "arm64",
      "djl",
      "CN",
    ]);
  });

  it("stores a null country when Cloudflare provides none", async () => {
    const db = new FakeD1();
    await handleRequest(
      post("/v1/installs", {
        installId: INSTALL_ID,
        version: "0.5.6",
        platform: "win32",
        arch: "x64",
      }),
      env(db),
      NOW,
    );
    expect(db.executed[0]?.args).toEqual([
      INSTALL_ID,
      NOW.toISOString(),
      "0.5.6",
      "win32",
      "x64",
      null,
      null,
    ]);
  });
});

describe("GET /v1/stats", () => {
  const get = (path: string, token?: string) =>
    new Request(`https://stats.djl.test${path}`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });

  it("requires the configured bearer token", async () => {
    const db = new FakeD1();
    expect((await handleRequest(get("/v1/stats"), env(db, "secret"), NOW)).status).toBe(401);
    expect((await handleRequest(get("/v1/stats", "wrong"), env(db, "secret"), NOW)).status).toBe(401);
    expect((await handleRequest(get("/v1/stats", "secret"), env(db), NOW)).status).toBe(401);
    expect(db.executed).toHaveLength(0);
  });

  it("returns the summary built from the batched queries", async () => {
    const db = new FakeD1([
      ["SELECT count(*) AS count FROM visits", [{ count: 4 }]],
      ["count(DISTINCT visitor_id)", [{ count: 2 }]],
      ["country AS key, count(*) AS count FROM visits", [{ key: "CA", count: 4 }]],
      ["path AS key, count(*) AS count FROM visits", [{ key: "/guide", count: 4 }]],
      ["SELECT count(*) AS count FROM installs", [{ count: 2 }]],
      ["country AS key, count(*) AS count FROM installs", [{ key: "CN", count: 2 }]],
      ["SELECT count(*) AS count FROM downloads", [{ count: 5 }]],
      [
        "source AS key",
        [
          { key: "github", count: 3 },
          { key: "oss", count: 2 },
        ],
      ],
    ]);
    const response = await handleRequest(get("/v1/stats", "secret"), env(db, "secret"), NOW);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      visits: { pageViews: number; uniqueVisitors: number; byPath: Record<string, number> };
      installs: { total: number; byCountry: Record<string, number> };
      downloads: { total: number; bySource: Record<string, number>; byDay: unknown[] };
    };
    expect(body.visits).toMatchObject({
      pageViews: 4,
      uniqueVisitors: 2,
      byPath: { "/guide": 4 },
    });
    expect(body.installs.total).toBe(2);
    expect(body.installs.byCountry).toEqual({ CN: 2 });
    expect(body.downloads.total).toBe(5);
    expect(body.downloads.bySource).toEqual({ github: 3, oss: 2 });
    expect(body.downloads.byDay).toHaveLength(30);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});

describe("GET /v1/public-stats", () => {
  it("returns only public download aggregates without a token", async () => {
    const db = new FakeD1([
      ["SELECT count(*) AS count FROM downloads", [{ count: 5 }]],
      ["source AS key", [{ key: "github", count: 3 }, { key: "oss", count: 2 }]],
      ["platform AS key", [{ key: "mac", count: 4 }, { key: "windows", count: 1 }]],
    ]);

    const response = await handleRequest(
      new Request("https://stats.djl.test/v1/public-stats"),
      env(db, "secret"),
      NOW,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      downloads: {
        total: 5,
        bySource: { github: 3, oss: 2 },
        byPlatform: { mac: 4, windows: 1 },
        byDay: expect.any(Array),
      },
    });
    expect(response.headers.get("cache-control")).toBe("public, max-age=60");
    expect(db.executed).toHaveLength(4);
    expect(db.executed.every(({ sql }) => sql.includes("downloads"))).toBe(true);
  });
});

describe("routing", () => {
  it("returns 404 for unknown paths and 405 for wrong methods", async () => {
    const db = new FakeD1();
    const at = (path: string, init?: RequestInit) =>
      handleRequest(new Request(`https://stats.djl.test${path}`, init), env(db), NOW);
    expect((await at("/")).status).toBe(404);
    expect((await at("/v1/visits")).status).toBe(405);
    expect((await at("/v1/downloads")).status).toBe(405);
    expect((await at("/v1/stats", { method: "POST" })).status).toBe(405);
    expect((await at("/v1/public-stats", { method: "POST" })).status).toBe(405);
  });
});
