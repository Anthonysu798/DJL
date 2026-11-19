import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  assertCommerceRuntimePrivileges,
  COMMERCE_APPEND_ONLY_TABLES,
  COMMERCE_STATE_HISTORY_TABLES,
  COMMERCE_RUNTIME_TABLES,
  type CommerceTablePrivileges,
} from "./commercePermissions.ts";

const fixture = (): CommerceTablePrivileges[] =>
  COMMERCE_RUNTIME_TABLES.map((tableName) => ({
    tableName,
    canSelect: true,
    canInsert: true,
    canUpdate: !new Set<string>(COMMERCE_APPEND_ONLY_TABLES).has(tableName),
    canDelete: false,
    canTruncate: false,
    ownsTable: false,
  }));

describe("commerce runtime accounting permissions", () => {
  it("keeps the deployment role source contract rejecting BYPASSRLS, not database acceptance", () => {
    const source = readFileSync(new URL("verify.ts", import.meta.url), "utf8").replace(/\s+/g, " ");
    expect(source).toMatch(
      /await sql`select current_user as name, [^`]*\brolbypassrls\b[^`]* from pg_roles where rolname = current_user`/,
    );
    expect(source).toMatch(
      /assert\( !role!\.rolsuper && !role!\.rolcreatedb && !role!\.rolcreaterole && !role!\.rolbypassrls, "Runtime role is overprivileged",? \);/,
    );
  });

  it("protects durable commerce email receipts from deletion and truncation", () => {
    expect(COMMERCE_STATE_HISTORY_TABLES).toContain("commerce_alert_email_deliveries");
  });

  it("permits required state updates but no financial-history rewrite or deletion", () => {
    expect(() => assertCommerceRuntimePrivileges(fixture())).not.toThrow();
    for (const tableName of COMMERCE_APPEND_ONLY_TABLES) {
      const rows = fixture();
      rows[COMMERCE_RUNTIME_TABLES.indexOf(tableName)] = {
        ...rows[COMMERCE_RUNTIME_TABLES.indexOf(tableName)]!,
        canUpdate: true,
      };
      expect(() => assertCommerceRuntimePrivileges(rows)).toThrow("accounting policy");
    }
  });
  it("rejects deleting, truncating, or owning any protected commerce history", () => {
    for (const name of COMMERCE_RUNTIME_TABLES)
      for (const privilege of ["canDelete", "canTruncate", "ownsTable"] as const) {
        const rows = fixture();
        rows[COMMERCE_RUNTIME_TABLES.indexOf(name)] = {
          ...rows[COMMERCE_RUNTIME_TABLES.indexOf(name)]!,
          [privilege]: true,
        };
        expect(() => assertCommerceRuntimePrivileges(rows)).toThrow("accounting policy");
      }
  });
  it("fails closed for missing, duplicated, unexpected, or unusable grants", () => {
    const rows = fixture();
    for (const broken of [
      rows.slice(1),
      [...rows, rows[0]!],
      [{ ...rows[0]!, tableName: "unrelated" }, ...rows.slice(1)],
    ])
      expect(() => assertCommerceRuntimePrivileges(broken)).toThrow("accounting policy");
    for (const privilege of ["canSelect", "canInsert", "canUpdate"] as const) {
      const broken = fixture();
      const index = COMMERCE_RUNTIME_TABLES.indexOf("commerce_orders");
      broken[index] = { ...broken[index]!, [privilege]: false };
      expect(() => assertCommerceRuntimePrivileges(broken)).toThrow("accounting policy");
    }
  });
  it("keeps deployment SQL revocations aligned with the verified table manifest", () => {
    const policy = readFileSync(
      new URL("../../../../infra/postgres/policies.sql", import.meta.url),
      "utf8",
    ).replace(/\s+/g, " ");
    expect(policy).toContain(
      `REVOKE UPDATE, DELETE, TRUNCATE ON ${COMMERCE_APPEND_ONLY_TABLES.join(", ")} FROM djl_app;`,
    );
    expect(policy).toContain(
      `REVOKE DELETE, TRUNCATE ON ${COMMERCE_STATE_HISTORY_TABLES.join(", ")} FROM djl_app;`,
    );
  });
});
