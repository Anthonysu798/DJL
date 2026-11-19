import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { admin, getToken } = vi.hoisted(() => ({ admin: vi.fn(), getToken: vi.fn() }));
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  admin,
  getToken,
}));
import { AdminApiError } from "@/lib/api";
import { SupplierStatementAdmin } from "./SupplierStatementAdmin";

const supplierA = { id: "supplier-a", name: "Synthetic Supplier A" };
const supplierB = { id: "supplier-b", name: "Synthetic Supplier B" };
const statement = (supplier: typeof supplierA) => ({
  supplier: { ...supplier, active: true },
  mode: "test",
  currency: "CAD",
  settlementAssessment: "not_assessed",
  generatedAt: "2026-10-29T12:00:00Z",
  period: { from: null, to: "2026-10-29T12:00:00Z" },
  summary: {
    openingCents: 0,
    accruedCents: 7000,
    reversedCents: 0,
    closingCents: 7000,
    unclassifiedCents: 0,
    equationDifferenceCents: 0,
    unclassifiedEntries: 0,
    reconciliationOk: true,
    hasUnresolvedRefunds: false,
  },
  rows: [],
  page: 0,
  pageSize: 100,
  totalRows: 0,
  hasMore: false,
});
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  admin.mockReset();
  getToken.mockReset();
  getToken.mockReturnValue("admin-a");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
const button = (label: string) => {
  const found = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
    (node) => node.textContent === label,
  );
  if (!found) throw Error("Missing " + label);
  return found;
};
const submit = async (form: HTMLFormElement) => {
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
};

describe("real supplier statement parent with the real document child, mocked transport only", () => {
  it("keeps statement and document pages readable without offering TEST document registration", async () => {
    const statementPath = "/commerce/suppliers/supplier-a/statement";
    const recordsPath = "/commerce/suppliers/supplier-a/payment-records";
    admin.mockImplementation(async (path, init) => {
      if (init?.method) throw Error("Only read requests expected");
      if (path === statementPath) return { ...statement(supplierA), hasMore: true };
      if (path.startsWith(statementPath + "?") && path.includes("page=1"))
        return { ...statement(supplierA), page: 1 };
      if (!path.startsWith(recordsPath)) throw Error("Unexpected request");
      const page = path.includes("page=1") ? 1 : 0;
      return {
        mode: "test",
        currency: "CAD",
        supplierSettlement: "unsupported",
        recordingEnabled: true,
        disabledReason: null,
        records: [
          {
            id: "existing-document-" + page,
            supplierId: supplierA.id,
            operationId: "existing-operation-" + page,
            amountCents: 1234,
            mode: "test",
            currency: "CAD",
            source: "unverified_manual_test_document",
            reference: "HISTORICAL-REF-" + page,
            evidenceReference: "TEST-EVIDENCE",
            reason: "Synthetic historical document",
            recordedBy: "recording-admin",
            recordedAt: "2026-10-29T12:00:00Z",
            bankVerified: false,
            settlementApplied: false,
            referenceShared: false,
          },
        ],
        page,
        pageSize: 100,
        hasMore: page === 0,
      };
    });
    await act(async () =>
      root.render(<SupplierStatementAdmin suppliers={[supplierA]} canWrite={false} />),
    );
    await submit(button("查询供货应付对账单").closest("form")!);
    expect(host.textContent).toContain("期末应付 CAD 70.00");
    expect(host.textContent).toContain("HISTORICAL-REF-0");
    expect(host.textContent).not.toContain("登记 TEST 付款资料");
    expect(host.querySelector('input[name="amountCents"]')).toBeNull();
    await act(async () => button("下一页对账单").click());
    expect(
      admin.mock.calls.some(
        ([path]) => path.startsWith(statementPath + "?") && path.includes("page=1"),
      ),
    ).toBe(true);
    await act(async () => button("下一页资料").click());
    expect(host.textContent).toContain("HISTORICAL-REF-1");
    await act(async () => button("刷新资料记录").click());
    expect(admin.mock.calls.filter(([path]) => path === recordsPath + "?page=1")).toHaveLength(2);
    expect(admin.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });
  it("does not unmount an unknown intent while statement becomes null, remains loading, then changes supplier", async () => {
    let finishB!: (value: unknown) => void;
    admin.mockImplementation(async (path, init) => {
      if (path === "/commerce/suppliers/supplier-a/statement") return statement(supplierA);
      if (path === "/commerce/suppliers/supplier-b/statement")
        return new Promise((resolve) => {
          finishB = resolve;
        });
      if (path.includes("/by-operation/")) throw new AdminApiError(404, "not_found", "No document");
      if (init?.method === "POST") throw new TypeError("Original result unknown");
      return {
        mode: "test",
        currency: "CAD",
        supplierSettlement: "unsupported",
        recordingEnabled: true,
        disabledReason: null,
        records: [],
        page: 0,
        pageSize: 100,
        hasMore: false,
      };
    });
    await act(async () =>
      root.render(<SupplierStatementAdmin suppliers={[supplierA, supplierB]} />),
    );
    await submit(button("查询供货应付对账单").closest("form")!);
    const recordForm = button("登记 TEST 付款资料").closest("form")!;
    for (const [name, value] of Object.entries({
      amountCents: "1234",
      reference: "TEST-ORIGINAL",
      evidenceReference: "TEST-EVIDENCE",
      reason: "Synthetic original supplier intent",
    }))
      (recordForm.elements.namedItem(name) as HTMLInputElement).value = value;
    (recordForm.elements.namedItem("acknowledge") as HTMLInputElement).checked = true;
    await submit(recordForm);
    const posts = () => admin.mock.calls.filter(([, init]) => init?.method === "POST");
    const originalBody = posts()[0]![1].json;
    const query = button("查询供货应付对账单").closest("form")!;
    (query.elements.namedItem("supplierId") as HTMLSelectElement).value = supplierB.id;
    await submit(query);
    expect(host.textContent).toContain("正在读取测试对账单");
    expect(host.textContent).toContain(originalBody.operationId);
    expect(button("按原完整请求重试资料登记").disabled).toBe(true);
    await act(async () => finishB(statement(supplierB)));
    expect(host.textContent).toContain("Synthetic Supplier B");
    expect(host.textContent).toContain("先核对原资料");
    expect(host.textContent).toContain(originalBody.operationId);
    expect(button("按原完整请求重试资料登记").disabled).toBe(false);
    const beforeRetry = admin.mock.calls.length;
    await act(async () => button("按原完整请求重试资料登记").click());
    expect(admin.mock.calls[beforeRetry]![0]).toBe(
      "/commerce/suppliers/supplier-a/payment-records/by-operation/" + originalBody.operationId,
    );
    expect(posts()).toHaveLength(2);
    expect(posts()[1]![0]).toBe("/commerce/suppliers/supplier-a/payment-records");
    expect(posts()[1]![1].json).toEqual(originalBody);
  });
});
