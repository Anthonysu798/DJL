import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CommerceReconciliationReport } from "@synara/contracts/cloud";
const { admin, getToken } = vi.hoisted(() => ({ admin: vi.fn(), getToken: vi.fn() }));
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  admin,
  getToken,
}));
import { AdminApiError } from "@/lib/api";
import { Reconciliation } from "./Reconciliation";

const header = "type,businessId,externalId,amountCents,currency,occurredAt";
const csv = `${header}\npayment,synthetic-order,pi_TEST,3900,CAD,2026-10-26T12:00:00Z`;
const statuses = [
  "matched",
  "not_found",
  "identifier_mismatch",
  "amount_mismatch",
  "duplicate",
  "ambiguous",
  "unresolved",
  "inconsistent",
  "unsupported",
] as const;
const report: CommerceReconciliationReport = {
  mode: "test",
  currency: "CAD",
  source: "unverified_manual_test_statement",
  fileCompleteness: "not_assessed",
  bankBalance: "not_assessed",
  supplierSettlement: "unsupported",
  generatedAt: "2026-10-26T12:00:00Z",
  summary: { rows: statuses.length, matched: 1, exceptions: statuses.length - 1 },
  rows: statuses.map((status, index) => ({
    rowNumber: index + 2,
    type: index === 8 ? "supplier_payout" : "payment",
    businessId: `synthetic-${index}`,
    amountCents: 3900,
    status,
    expectedAmountCents: status === "amount_mismatch" ? 4000 : status === "matched" ? 3900 : null,
    differenceCents: status === "amount_mismatch" ? -100 : status === "matched" ? 0 : null,
    ledgerEntryIds: status === "matched" ? ["ledger-test"] : [],
    supplierPaymentDocumentId: null,
  })),
};
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  admin.mockReset();
  getToken.mockReset();
  getToken.mockReturnValue("admin-a");
  admin.mockResolvedValue({ report });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const show = async (disabled = false) => {
  await act(async () => root.render(<Reconciliation disabled={disabled} />));
};
const choose = async (
  name = "test.csv",
  text: () => Promise<string> = async () => csv,
  size = csv.length,
) => {
  const file = new File(["x".repeat(size)], name, { type: "text/csv" });
  Object.defineProperty(file, "text", { value: text });
  const input = host.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw Error("Missing CSV input");
  Object.defineProperty(input, "files", { configurable: true, value: [file] });
  await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
};
const submit = async () => {
  const button = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
    (node) => node.textContent === "开始只读比对",
  );
  if (!button) throw Error("Missing compare button");
  await act(async () => button.click());
};

describe("TEST-only unverified manual statement comparison", () => {
  it("separates matching supplier documents from financial matched rows and ledger entries", async () => {
    admin.mockResolvedValue({
      report: {
        ...report,
        summary: { rows: 1, matched: 0, exceptions: 1 },
        rows: [
          {
            ...report.rows[0]!,
            type: "supplier_payout",
            status: "manual_record_fields_match",
            supplierPaymentDocumentId: "manual-document-1",
            ledgerEntryIds: [],
          },
        ],
      },
    });
    await show();
    await choose();
    await submit();
    expect(host.textContent).toContain("人工TEST资料字段一致（未结算）");
    expect(host.textContent).toContain("资料记录 ID manual-document-1（不是账本分录）");
    expect(host.textContent).toContain("金融测试记录字段一致 0 行");
    expect(host.textContent).toContain("待核查 1 行");
    expect(host.textContent).not.toContain("ledger-test");
  });
  it("displays the exact CAD cents of a large manual document without rounding its last cent", async () => {
    admin.mockResolvedValue({
      report: {
        ...report,
        summary: { rows: 1, matched: 0, exceptions: 1 },
        rows: [
          {
            ...report.rows[0]!,
            type: "supplier_payout",
            status: "manual_record_fields_match",
            supplierPaymentDocumentId: "manual-large",
            amountCents: 9007199254740990,
            expectedAmountCents: 9007199254740990,
            differenceCents: 0,
            ledgerEntryIds: [],
          },
        ],
      },
    });
    await show();
    await choose();
    await submit();
    expect(host.textContent).toContain("CAD 90071992547409.90");
  });
  it.each(["financial_match", "ledger", "missing_id", "wrong_type", "summary"] as const)(
    "refuses supplier document reports that imply %s financial proof",
    async (kind) => {
      const row = {
        ...report.rows[0]!,
        type: "supplier_payout",
        status: "manual_record_fields_match",
        supplierPaymentDocumentId: "must-not-display",
        ledgerEntryIds: [],
      };
      admin.mockResolvedValue({
        report: {
          ...report,
          summary: {
            rows: 1,
            matched: kind === "summary" || kind === "financial_match" ? 1 : 0,
            exceptions: kind === "summary" || kind === "financial_match" ? 0 : 1,
          },
          rows: [
            {
              ...row,
              ...(kind === "financial_match" ? { status: "matched" } : {}),
              ...(kind === "ledger" ? { ledgerEntryIds: ["fake-ledger"] } : {}),
              ...(kind === "missing_id" ? { supplierPaymentDocumentId: null } : {}),
              ...(kind === "wrong_type" ? { type: "payment" } : {}),
            },
          ],
        },
      });
      await show();
      await choose();
      await submit();
      expect(host.querySelector('[role="alert"]')).not.toBeNull();
      expect(host.textContent).not.toContain("must-not-display");
      expect(host.textContent).not.toContain("fake-ledger");
    },
  );
  it("shows all exception classes, never equates matching fields with bank confirmation, and keeps CSV only in memory", async () => {
    const persist = vi.spyOn(Storage.prototype, "setItem");
    await show();
    expect(admin).not.toHaveBeenCalled();
    await choose();
    await submit();
    expect(admin).toHaveBeenCalledWith(
      "/commerce/reconciliation/compare",
      expect.objectContaining({ method: "POST", json: { csv } }),
    );
    for (const text of [
      "测试记录字段一致",
      "未找到记录",
      "外部标识不一致",
      "金额不一致",
      "文件内重复",
      "存在多个候选",
      "结果尚未确认",
      "账本或业务记录不一致",
      "不支持比对",
      "人工文件来源未核验",
      "银行余额未评估",
      "供应商应付不是已付款",
      "未核实",
    ])
      expect(host.textContent).toContain(text);
    expect(host.textContent).not.toContain("银行已核验");
    expect(persist).not.toHaveBeenCalled();
  });
  it("rejects oversized files and oversized decoded UTF8 before calling the server", async () => {
    await show();
    await choose("large.csv", async () => csv, 200001);
    expect(host.textContent).toContain("200000");
    await submit();
    expect(admin).not.toHaveBeenCalled();
    await choose("utf8.csv", async () => "中".repeat(100000), 1);
    await submit();
    expect(host.textContent).toContain("200000");
    expect(admin).not.toHaveBeenCalled();
  });
  it.each([
    "commerce_reconciliation_csv_invalid",
    "commerce_reconciliation_csv_too_large",
    "commerce_reconciliation_disabled",
    "commerce_reconciliation_unavailable",
  ])("keeps %s failures unconfirmed, not zero exceptions", async (code) => {
    admin.mockRejectedValue(new AdminApiError(503, code, "Rejected"));
    await show();
    await choose();
    await submit();
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    expect(host.textContent).not.toContain("异常 0");
    expect(host.textContent).not.toContain("测试记录字段一致");
  });
  it("drops a prior result when selecting a new file or a later comparison fails", async () => {
    await show();
    await choose();
    await submit();
    expect(host.textContent).toContain("测试记录字段一致");
    await choose("second.csv");
    expect(host.textContent).not.toContain("测试记录字段一致");
    admin.mockRejectedValueOnce(new TypeError("Offline"));
    await submit();
    expect(host.textContent).toContain("比对结果尚未确认");
    expect(host.textContent).not.toContain("测试记录字段一致");
  });
  it("does not upload an old file after its delayed text read completes following a new selection", async () => {
    let finish!: (text: string) => void;
    await show();
    await choose(
      "old.csv",
      () =>
        new Promise((done) => {
          finish = done;
        }),
    );
    await submit();
    await choose("new.csv");
    await act(async () => finish(csv));
    expect(admin).not.toHaveBeenCalled();
    await submit();
    expect(admin).toHaveBeenCalledTimes(1);
  });
  it("does not display an old API response after a newer selected file has completed", async () => {
    let finish!: (value: unknown) => void;
    admin.mockImplementationOnce(
      () =>
        new Promise((done) => {
          finish = done;
        }),
    );
    await show();
    await choose("old.csv");
    await submit();
    await choose("new.csv");
    admin.mockResolvedValueOnce({
      report: {
        ...report,
        rows: [{ ...report.rows[1]!, businessId: "new-file" }],
        summary: { rows: 1, matched: 0, exceptions: 1 },
      },
    });
    await submit();
    await act(async () => finish({ report }));
    expect(host.textContent).not.toContain("synthetic-0");
    const body = host.querySelector("tbody");
    expect(body).not.toBeNull();
    expect(body!.querySelectorAll("tr")).toHaveLength(1);
    expect(body!.textContent).toContain("new-file");
    expect(body!.textContent).toContain("未找到记录");
    expect(body!.textContent).not.toContain("测试记录字段一致");
    expect(host.textContent).toContain("金融测试记录字段一致 0 行");
    expect(host.textContent).toContain("待核查 1 行");
  });
  it("clears the former account's file/result and ignores its late failure on account switch", async () => {
    let reject!: (value: unknown) => void;
    admin.mockImplementationOnce(
      () =>
        new Promise((_done, fail) => {
          reject = fail;
        }),
    );
    await show();
    await choose("account-a.csv");
    await submit();
    getToken.mockReturnValue("admin-b");
    await show();
    await act(async () => reject(new AdminApiError(401, "unauthorized", "Old account")));
    expect(host.textContent).not.toContain("account-a.csv");
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });
  it("does not retain a response across unmount and remount or submit when disabled", async () => {
    let finish!: (value: unknown) => void;
    admin.mockImplementationOnce(
      () =>
        new Promise((done) => {
          finish = done;
        }),
    );
    await show();
    await choose();
    await submit();
    await act(async () => root.render(<></>));
    await show(true);
    await act(async () => finish({ report }));
    expect(host.textContent).not.toContain("synthetic-0");
    expect(host.querySelector<HTMLButtonElement>("button")?.disabled).toBe(true);
  });
  it("clears the active file and loading state when the current request invalidates its login", async () => {
    let reject!: (value: unknown) => void;
    admin.mockImplementationOnce(
      () =>
        new Promise((_done, fail) => {
          reject = fail;
        }),
    );
    await show();
    await choose("private.csv");
    await submit();
    getToken.mockReturnValue(null);
    await act(async () => reject(new AdminApiError(401, "unauthorized", "Expired")));
    expect(host.textContent).toContain("请重新确认管理员登录");
    expect(host.textContent).not.toContain("private.csv");
    expect(host.textContent).not.toContain("正在读取并比对");
  });
});
