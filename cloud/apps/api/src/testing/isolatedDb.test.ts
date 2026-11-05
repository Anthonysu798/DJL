import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  events: [] as string[],
  postgres: vi.fn(),
  unsafe: vi.fn(),
  adminEnd: vi.fn(),
  clientClose: vi.fn(),
  createDatabase: vi.fn(),
  migrate: vi.fn(),
  fallback: vi.fn(),
}));
vi.mock("postgres", () => ({ default: mocks.postgres }));
vi.mock("@djl/db", () => ({ createDatabase: mocks.createDatabase }));
vi.mock("drizzle-orm/postgres-js/migrator", () => ({ migrate: mocks.migrate }));
vi.mock("./db.ts", () => ({ testDatabase: mocks.fallback }));
import { isolatedCommerceTestDatabase } from "./isolatedDb.ts";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.events.length = 0;
  vi.stubEnv("DJL_ENV", "test");
  vi.stubEnv("COMMERCE_TEST_PGLITE", "");
  vi.stubEnv("DATABASE_URL", "postgres://fixture:fixture@localhost:54329/djl");
  mocks.postgres.mockReturnValue({ unsafe: mocks.unsafe, end: mocks.adminEnd });
  mocks.unsafe.mockImplementation(async (query: string) => {
    mocks.events.push(query);
  });
  mocks.adminEnd.mockImplementation(async () => {
    mocks.events.push("admin.end");
  });
  mocks.clientClose.mockImplementation(async () => {
    mocks.events.push("client.close");
  });
  mocks.createDatabase.mockReturnValue({ db: {}, sql: {}, close: mocks.clientClose });
  mocks.migrate.mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllEnvs());

describe("isolated commerce SQL suite database ownership", () => {
  it("migrates a random owned database and closes clients before dropping exactly that database once", async () => {
    const connection = await isolatedCommerceTestDatabase();
    const create = mocks.unsafe.mock.calls[0]![0] as string;
    expect(create).toMatch(/^CREATE DATABASE "djl_commerce_suite_[0-9a-f]{32}"$/);
    const name = create.split('"')[1]!;
    expect(new URL(mocks.createDatabase.mock.calls[0]![0]).pathname).toBe(`/${name}`);
    expect(mocks.migrate).toHaveBeenCalledOnce();
    expect(mocks.migrate.mock.calls[0]![1].migrationsFolder.replaceAll("\\", "/")).toMatch(
      /\/cloud\/packages\/db\/drizzle$/,
    );
    await connection.close();
    await connection.close();
    expect(mocks.events).toEqual([create, "client.close", `DROP DATABASE "${name}"`, "admin.end"]);
  });
  it("never drops a database when CREATE did not succeed", async () => {
    mocks.unsafe.mockRejectedValueOnce(new Error("CREATE refused"));
    await expect(isolatedCommerceTestDatabase()).rejects.toThrow("CREATE refused");
    expect(mocks.unsafe).toHaveBeenCalledOnce();
    expect(mocks.createDatabase).not.toHaveBeenCalled();
    expect(mocks.adminEnd).toHaveBeenCalledOnce();
  });
  it("cleans up only its newly created database when a migration fails", async () => {
    mocks.migrate.mockRejectedValueOnce(new Error("Migration refused"));
    await expect(isolatedCommerceTestDatabase()).rejects.toThrow("Migration refused");
    const create = mocks.events[0]!,
      name = create.split('"')[1]!;
    expect(mocks.events).toEqual([create, "client.close", `DROP DATABASE "${name}"`, "admin.end"]);
  });
  it("rejects staging/production before opening a connection, even with a supplemental PGlite flag", async () => {
    vi.stubEnv("COMMERCE_TEST_PGLITE", "true");
    for (const env of ["staging", "production", "unknown"]) {
      vi.stubEnv("DJL_ENV", env);
      await expect(isolatedCommerceTestDatabase()).rejects.toThrow("local or test");
    }
    expect(mocks.postgres).not.toHaveBeenCalled();
    expect(mocks.fallback).not.toHaveBeenCalled();
  });
  it("refuses invalid and non-loopback database targets", async () => {
    for (const value of [
      "not a URL",
      "postgres://fixture:fixture@database.test/djl",
      "https://localhost/djl",
    ]) {
      vi.stubEnv("DATABASE_URL", value);
      await expect(isolatedCommerceTestDatabase()).rejects.toThrow();
    }
    expect(mocks.postgres).not.toHaveBeenCalled();
  });
  it("delegates the optional PGlite supplement without creating or dropping a PostgreSQL database", async () => {
    vi.stubEnv("COMMERCE_TEST_PGLITE", "true");
    const connection = { db: {}, close: vi.fn() };
    mocks.fallback.mockReturnValue(connection);
    expect(await isolatedCommerceTestDatabase()).toBe(connection);
    expect(mocks.postgres).not.toHaveBeenCalled();
  });
});
