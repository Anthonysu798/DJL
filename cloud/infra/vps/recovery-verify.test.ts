/** Static safety contracts only. These do not execute psql or prove a restored database. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("recovery-verify.sql", import.meta.url), "utf8");
const sql = source.replace(/--[^\r\n]*/g, "").replace(/\s+/g, " ");

describe("recovery verification SQL safety contracts", () => {
  it("counts manual pending and unknown withdrawals as still-frozen obligations", () => {
    expect(sql).toContain(
      "WHERE status IN ('requested','approved','payment_pending','payment_unknown') GROUP BY user_id",
    );
  });
  it("requires incident history for email receipts and validates their durable state", () => {
    expect(sql).toContain("to_regclass('public.commerce_alert_email_deliveries')");
    expect(sql).toMatch(/name='alert_email'.*name='alerts' AND n<>expected/);
    expect(sql).toContain("'name','commerce_alert_email_delivery_consistency'");
  });

  it("uses one repeatable read-only snapshot and only the two fixed psql generators", () => {
    expect(sql).toMatch(/BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;/);
    expect(sql.indexOf("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;")).toBeLessThan(
      sql.indexOf("SELECT"),
    );
    expect(sql.trim()).toMatch(/COMMIT;$/);
    expect(source.match(/^\\gexec\s*$/gm)).toHaveLength(2);
    expect(source.match(/^\\[^\r\n]*/gm)).toEqual(["\\set ON_ERROR_STOP on", "\\gexec", "\\gexec"]);
    expect(sql).not.toMatch(
      /\b(?:INSERT|UPDATE|DELETE|MERGE|TRUNCATE|ALTER|DROP|CREATE|COPY|GRANT|REVOKE|CALL|DO|VACUUM|ANALYZE|nextval|setval)\b/i,
    );
    expect(sql).not.toMatch(/(?<!:):(?:[A-Za-z_]|'[A-Za-z_])/);
  });

  it("fingerprints only restorable sequence state and hashes rows without printing their values", () => {
    expect(sql).toMatch(
      /CASE WHEN c\.relkind='S' THEN 'jsonb_build_object\(''last_value'',t\.last_value,''is_called'',t\.is_called\)::text' ELSE 'to_jsonb\(t\)::text' END/,
    );
    expect(sql).not.toContain("log_cnt");
    expect(sql).toContain("sha256(convert_to(%s,'UTF8'))");
    expect(sql).toContain("FROM %I.%I t");
    expect(sql).toContain("'schema',%L,'name',%L");
    expect(sql).toContain("row_number() OVER (ORDER BY h)");
    expect(sql).toContain("string_agg(h,'' ORDER BY chunk)");
  });

  it("sorts every invariant in one generator and accepts old schema families only with their dependencies", () => {
    const sections = source.split(/^\\gexec\s*$/m);
    expect(sections).toHaveLength(3);
    expect(sections[0]).not.toContain("'kind','invariant'");
    expect(sections[1]).toContain("('commerce_schema_families',true,$query$");
    expect(sections[1]).toMatch(/WHERE available ORDER BY name COLLATE "C"/);
    expect(sql).toContain("n NOT IN (0,expected)");
    expect(sql).toMatch(/name IN \('payment','external','alerts'\).*name='core' AND n<>expected/);
    expect(sql).toMatch(/name='external'.*name='payment' AND n<>expected/);
  });

  it("retains the finance and AI credit consistency checks in the checked-in SQL", () => {
    for (const name of [
      "commerce_commission_snapshots",
      "commerce_external_allocations",
      "commerce_journals_balanced",
      "commerce_order_totals",
      "commerce_schema_families",
      "commerce_wallet_signs",
      "commerce_withdrawal_frozen",
      "credit_balance_fold",
    ])
      expect(sql).toContain(`'name','${name}'`);
    expect(sql).toContain("'violations'");
    expect(sql).not.toMatch(/\b(?:repair|dblink|lo_export|pg_read_file|pg_write_file)\s*\(/i);
  });
});
