import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type { CommerceSupplierStatement } from "@synara/contracts/cloud";

const { supplierStatement } = vi.hoisted(() => ({ supplierStatement: vi.fn() }));
vi.mock("@/lib/commerce", async (original) => ({
  ...(await original<typeof import("@/lib/commerce")>()),
  commerce: { supplierStatement },
}));
import { SupplierStatement } from "./SupplierStatement";

const statement: CommerceSupplierStatement = {
  supplier: { id: "supplier-1", name: "Test Supplier", active: true },
  currency: "CAD",
  mode: "test",
  settlementAssessment: "not_assessed",
  generatedAt: "2026-10-26T12:00:00.123456Z",
  period: { from: null, to: "2026-10-26T12:00:00.123456Z" },
  summary: {
    openingCents: 0,
    accruedCents: 5000,
    reversedCents: 1500,
    unclassifiedCents: -100,
    closingCents: 3400,
    equationDifferenceCents: 0,
    reconciliationOk: false,
    unclassifiedEntries: 1,
    hasUnresolvedRefunds: true,
  },
  rows: [
    {
      eventKey: "paid:test-order",
      resourceId: "test-order",
      ledgerEntryIds: ["entry-a"],
      createdAt: "2026-10-26T10:00:00Z",
      kind: "cost_accrual",
      amountCents: 5000,
      orderId: "test-order",
      orderItemId: null,
      items: [
        {
          itemId: "item-1",
          sku: "HISTORICAL-RED",
          name: "供货商品",
          quantity: 2,
          unitCostCents: 2500,
          totalCostCents: 5000,
        },
      ],
    },
    {
      eventKey: "refund:test-line",
      resourceId: "test-line",
      ledgerEntryIds: ["entry-b"],
      createdAt: "2026-10-26T11:00:00Z",
      kind: "refund_reversal",
      amountCents: -1500,
      orderId: "test-order",
      orderItemId: "test-line",
      items: [
        {
          itemId: "test-line",
          sku: null,
          name: "历史商品",
          quantity: 1,
          unitCostCents: 1500,
          totalCostCents: 1500,
        },
      ],
    },
  ],
  page: 0,
  pageSize: 100,
  hasMore: true,
  totalRows: 101,
};
beforeEach(() => {
  supplierStatement.mockReset();
  supplierStatement.mockImplementation(async (_id, query) => ({
    ...statement,
    page: query?.page ?? 0,
    hasMore: !query?.page,
  }));
});
const show = () =>
  render(<SupplierStatement suppliers={[{ id: "supplier-1", name: "Test Supplier" }]} />);

it("shows only server test costs, payable totals and refund reversals with no payout action", async () => {
  show();
  expect(supplierStatement).not.toHaveBeenCalled();
  expect(screen.getByText("请选择供应商和范围查询，尚未读取应付金额。")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "查询供货应付对账单" }));
  await screen.findByText("Test Supplier · 只读测试应付");
  expect(supplierStatement).toHaveBeenCalledWith("supplier-1", {});
  expect(screen.getByText(/期末应付/).textContent).toContain("34.00");
  expect(screen.getByText(/退款应付冲回/)).toBeInTheDocument();
  expect(screen.getByText(/HISTORICAL-RED/)).toBeInTheDocument();
  expect(screen.getByText(/历史订单未记录 SKU/)).toBeInTheDocument();
  expect(screen.getByText(/仍有退款结果或商品归属待核实/)).toBeInTheDocument();
  expect(screen.getByText(/不是到期可付款金额/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /提现|付款|打款/ })).not.toBeInTheDocument();
  const refund = screen.getByText("退款应付冲回").closest("tr")!;
  expect(within(refund).getByText(/-.*15.00/)).toBeInTheDocument();
});
it("converts initial local-time filters to UTC and reuses the exact server microsecond boundary for independent pages", async () => {
  show();
  const from = "2026-10-01T00:00";
  fireEvent.change(screen.getByLabelText("对账起始时刻"), { target: { value: from } });
  supplierStatement.mockImplementation(async (_id, query) => ({
    ...statement,
    period: { ...statement.period, from: new Date(from).toISOString() },
    page: query?.page ?? 0,
  }));
  fireEvent.click(screen.getByRole("button", { name: "查询供货应付对账单" }));
  await screen.findByText("Test Supplier · 只读测试应付");
  expect(supplierStatement).toHaveBeenLastCalledWith("supplier-1", {
    from: new Date(from).toISOString(),
  });
  fireEvent.click(screen.getByRole("button", { name: "下一页对账单" }));
  await waitFor(() =>
    expect(supplierStatement).toHaveBeenLastCalledWith("supplier-1", {
      from: new Date(from).toISOString(),
      to: statement.period.to,
      page: 1,
    }),
  );
  await screen.findByText("第 2 页 · 共 101 条分录");
});
it("does not show zero or stale payable totals after a failed query", async () => {
  show();
  fireEvent.click(screen.getByRole("button", { name: "查询供货应付对账单" }));
  await screen.findByText("Test Supplier · 只读测试应付");
  supplierStatement.mockRejectedValueOnce(new TypeError("Offline"));
  fireEvent.click(screen.getByRole("button", { name: "下一页对账单" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "对账单查询失败，不能据此判断应付为零。",
  );
  expect(screen.queryByText(/期末应付/)).not.toBeInTheDocument();
  expect(screen.queryByText("当前查询范围没有应付流水。")).not.toBeInTheDocument();
});
