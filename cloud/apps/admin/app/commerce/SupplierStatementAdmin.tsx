"use client";

import { useState, type FormEvent } from "react";
import type { CommerceSupplierStatement } from "@synara/contracts/cloud";
import { admin } from "@/lib/api";
import { SupplierPaymentRecords } from "./SupplierPaymentRecords";

const money = (value: number) => `CAD ${(value / 100).toFixed(2)}`;
const button = "rounded-lg border border-border bg-card px-4 py-2 text-sm disabled:opacity-40";
const input = "mt-1 block rounded border border-border bg-background p-2";
const kinds = {
  cost_accrual: "采购成本应付增加",
  refund_reversal: "退款应付冲回",
  unclassified: "未分类变动，待核实",
};

export function SupplierStatementAdmin({
  suppliers,
  canWrite = true,
}: {
  suppliers: readonly { id: string; name: string }[];
  canWrite?: boolean;
}) {
  const [statement, setStatement] = useState<CommerceSupplierStatement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function load(id: string, query: { from?: string; to?: string; page?: number }) {
    if (busy) return;
    setBusy(true);
    setError(null);
    setStatement(null);
    const params = new URLSearchParams();
    if (query.from) params.set("from", query.from);
    if (query.to) params.set("to", query.to);
    if (query.page) params.set("page", String(query.page));
    try {
      setStatement(
        await admin<CommerceSupplierStatement>(
          `/commerce/suppliers/${encodeURIComponent(id)}/statement${params.size ? `?${params}` : ""}`,
        ),
      );
    } catch (cause) {
      setError(
        `对账单查询失败，不能据此判断应付为零。${cause instanceof TypeError ? "暂时无法连接商城管理服务，请稍后重试。" : cause instanceof Error ? cause.message : "请稍后重新查询。"}`,
      );
    } finally {
      setBusy(false);
    }
  }
  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const from = String(data.get("from") ?? "");
    const to = String(data.get("to") ?? "");
    void load(String(data.get("supplierId")), {
      ...(from ? { from: new Date(from).toISOString() } : {}),
      ...(to ? { to: new Date(to).toISOString() } : {}),
    });
  }
  function page(next: number) {
    if (!statement) return;
    void load(statement.supplier.id, {
      ...(statement.period.from ? { from: statement.period.from } : {}),
      to: statement.period.to,
      page: next,
    });
  }
  return (
    <section
      className="space-y-3 rounded-xl border border-border bg-card p-5"
      aria-label="供应商测试应付对账单"
    >
      <h2 className="text-lg font-semibold">供应商供货应付对账单 · TEST</h2>
      <p className="text-sm text-muted-foreground">
        与供应商使用同一测试账本口径，只读采购成本应付和退款冲回。不是到期可付款金额，不代表已付款或银行到账；没有新增结算或打款操作。
      </p>
      <form onSubmit={search} className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          对账供应商
          <select
            className={input}
            name="supplierId"
            aria-label="对账供应商"
            required
            disabled={busy}
          >
            {suppliers.map((supplier) => (
              <option key={supplier.id} value={supplier.id}>
                {supplier.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          起始时刻
          <input
            className={input}
            name="from"
            aria-label="对账起始时刻"
            type="datetime-local"
            disabled={busy}
          />
        </label>
        <label className="text-sm">
          结束时刻
          <input
            className={input}
            name="to"
            aria-label="对账结束时刻"
            type="datetime-local"
            disabled={busy}
          />
        </label>
        <button className={button} disabled={busy || !suppliers.length}>
          查询供货应付对账单
        </button>
      </form>
      <p className="text-xs text-muted-foreground">
        时间按浏览器本地时区输入，查询转为
        UTC，范围不含结束时刻。留空从最早记录至服务器当前时刻；分页固定服务器返回的结束边界。
      </p>
      {busy ? <p role="status">正在读取测试对账单…</p> : null}
      {error ? (
        <p role="alert" className="text-sm text-red-800">
          {error}
        </p>
      ) : null}
      {!statement && !busy && !error ? (
        <p className="text-sm">请选择供应商和范围查询，尚未读取应付金额。</p>
      ) : null}
      {statement ? (
        <>
          <h3 className="font-semibold">{statement.supplier.name} · 只读测试应付</h3>
          <p className="text-xs">
            已查询 UTC 范围：{statement.period.from ?? "最早记录"} 至 {statement.period.to}（不含）
          </p>
          <p className="text-sm">
            期初应付 {money(statement.summary.openingCents)} · 采购应付增加{" "}
            {money(statement.summary.accruedCents)} · 退款冲回{" "}
            {money(statement.summary.reversedCents)} · 未分类变动{" "}
            {money(statement.summary.unclassifiedCents)} · 期末应付{" "}
            {money(statement.summary.closingCents)}
          </p>
          <p className="text-xs">
            对账差额 {money(statement.summary.equationDifferenceCents)} · 未分类流水{" "}
            {statement.summary.unclassifiedEntries} 条 ·{" "}
            {statement.summary.reconciliationOk
              ? "账内等式核对一致"
              : "存在未分类或对账异常，待人工核实"}
          </p>
          {statement.summary.hasUnresolvedRefunds ? (
            <p className="text-sm text-amber-900">
              仍有退款结果或商品归属待核实，不能把此应付当作最终可付款金额。
            </p>
          ) : null}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr>
                  <th className="p-2">事件 / 时间</th>
                  <th>应付变动</th>
                  <th>历史成本快照 / 追踪</th>
                </tr>
              </thead>
              <tbody>
                {statement.rows.map((row) => (
                  <tr className="border-t border-border" key={row.eventKey}>
                    <td className="p-2">
                      {kinds[row.kind]}
                      <small className="block">
                        {row.createdAt}
                        <br />
                        {row.eventKey}
                      </small>
                    </td>
                    <td>{money(row.amountCents)}</td>
                    <td>
                      {row.items.map((item) => (
                        <p key={item.itemId}>
                          {item.name} · {item.sku ?? "历史订单未记录 SKU"} × {item.quantity} ·
                          单位采购成本 {money(item.unitCostCents)} · 成本快照合计{" "}
                          {money(item.totalCostCents)}
                        </p>
                      ))}
                      <small>
                        订单 {row.orderId ?? "无订单关联"} · 明细{" "}
                        {row.orderItemId ?? "整单分录，不逐项臆分"}
                        <br />
                        资源 {row.resourceId}
                        <br />
                        流水 {row.ledgerEntryIds.join("、")}
                      </small>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!statement.rows.length ? <p className="text-sm">当前查询范围没有应付流水。</p> : null}
          <div className="flex items-center gap-3">
            <button
              className={button}
              disabled={busy || statement.page === 0}
              onClick={() => page(statement.page - 1)}
            >
              上一页对账单
            </button>
            <span className="text-sm">
              第 {statement.page + 1} 页 · 共 {statement.totalRows} 条分录
            </span>
            <button
              className={button}
              disabled={busy || !statement.hasMore}
              onClick={() => page(statement.page + 1)}
            >
              下一页对账单
            </button>
          </div>
          <p className="text-xs text-muted-foreground">
            付款形成的采购应付可合并多件商品，成本使用历史快照，不把整单分录臆分到单项。生成时间{" "}
            {statement.generatedAt}；结算资格未评估。
          </p>
        </>
      ) : null}
      <SupplierPaymentRecords
        supplier={statement?.supplier ?? null}
        disabled={busy}
        canWrite={canWrite}
      />
    </section>
  );
}
