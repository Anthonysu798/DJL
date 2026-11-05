import { describe, expect, it, vi } from "vitest";
import type { DjlDatabase } from "@djl/db";
import {
  COMMERCE_RECONCILIATION_CSV_HEADER as header,
  COMMERCE_RECONCILIATION_MAX_BYTES,
} from "@synara/contracts/cloud";
import {
  CommerceReconciliationService,
  parseCommerceReconciliationCsv,
} from "./CommerceReconciliationService.ts";

const id = "00000000-0000-4000-8000-000000000001";
const at = "2026-10-26T12:00:00.123456Z";
const row = `payment,${id},pi_test_fixture,3900,CAD,${at}`;
const csv = `${header}\n${row}`;

describe("manual TEST comparison CSV boundaries", () => {
  it("accepts the exact header, UTF8 BOM and quoted CSV without interpreting text", () => {
    expect(parseCommerceReconciliationCsv(`\uFEFF${header}\r\n${row}\r\n`)).toEqual([
      {
        rowNumber: 2,
        type: "payment",
        businessId: id,
        externalId: "pi_test_fixture",
        amountCents: 3900,
        occurredAt: at,
      },
    ]);
    expect(
      parseCommerceReconciliationCsv(
        `${header}\ncommission_payout,${id},"test, ""reference""",2000,CAD,${at}`,
      )[0]?.externalId,
    ).toBe('test, "reference"');
  });
  it.each([
    undefined,
    [],
    "",
    header,
    `"${header}"\n${row}`,
    `"type,businessId",externalId,amountCents,currency,occurredAt\n${row}`,
    ` ${csv}`,
    csv.replace("CAD", "USD"),
    csv.replace("3900", "1.5"),
    csv.replace("3900", "-1"),
    csv.replace("3900", "0"),
    csv.replace("3900", "1e3"),
    csv.replace("3900", "9007199254740992"),
    csv.replace("3900", "03900"),
    csv.replace(id, "bad-id"),
    csv.replace("pi_test_fixture", "re_wrong_type"),
    csv.replace(at, "2026-02-30T12:00:00Z"),
    csv.replace(at, "2026-10-26T12:00:00+00:00"),
    `${csv},extra`,
    `${header}\n"unclosed`,
    `${header}\n"payment"x,${id},pi_x,1,CAD,${at}`,
    `${header}\n${row}\n\n${row}`,
    csv.replace("pi_test_fixture", "pi_test\u0000secret"),
  ])("rejects malformed or ambiguous input without exposing its contents", (input) => {
    expect(() => parseCommerceReconciliationCsv(input)).toThrow(
      expect.objectContaining({ status: 400, code: "commerce_reconciliation_csv_invalid" }),
    );
  });
  it("enforces byte and row limits, including multibyte text", () => {
    expect(() =>
      parseCommerceReconciliationCsv("é".repeat(COMMERCE_RECONCILIATION_MAX_BYTES / 2 + 1)),
    ).toThrow(expect.objectContaining({ status: 413 }));
    expect(() =>
      parseCommerceReconciliationCsv(`${header}\n${Array(1001).fill(row).join("\n")}`),
    ).toThrow(expect.objectContaining({ status: 400 }));
    expect(
      parseCommerceReconciliationCsv(`${header}\n${Array(1000).fill(row).join("\n")}`),
    ).toHaveLength(1000);
    expect(
      parseCommerceReconciliationCsv(csv.replace("3900", "9007199254740991"))[0]?.amountCents,
    ).toBe(Number.MAX_SAFE_INTEGER);
  });
  it("fails closed outside local/test or when commerce is disabled before accessing the database", async () => {
    const transaction = vi.fn();
    for (const options of [
      { mode: "test", environment: "production" },
      { mode: "test", environment: "staging" },
      { mode: "disabled", environment: "test" },
    ] as const) {
      const service = new CommerceReconciliationService(
        { transaction } as unknown as DjlDatabase,
        options,
      );
      await expect(service.compare(csv)).rejects.toMatchObject({
        status: 503,
        code: "commerce_reconciliation_disabled",
      });
    }
    expect(transaction).not.toHaveBeenCalled();
  });
});
