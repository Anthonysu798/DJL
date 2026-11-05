"use client";

import { useState, type FormEvent } from "react";
import type { CommerceSupplierStatement } from "@synara/contracts/cloud";
import { commerce, commerceErrorMessage } from "@/lib/commerce";
import styles from "./shop.module.css";
const cad = (cents: number) => `CAD ${(cents / 100).toFixed(2)}`;

const kindLabels = {
  cost_accrual: "采购成本应付增加",
  refund_reversal: "退款应付冲回",
  unclassified: "未分类变动，待核实",
};

export function SupplierStatement({
  suppliers,
}: {
  suppliers: readonly { id: string; name: string }[];
}) {
  const [statement, setStatement] = useState<CommerceSupplierStatement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function load(supplierId: string, query: { from?: string; to?: string; page?: number }) {
    if (busy) return;
    setBusy(true);
    setError(null);
    setStatement(null);
    try {
      setStatement(await commerce.supplierStatement(supplierId, query));
    } catch (cause) {
      setError(`对账单查询失败，不能据此判断应付为零。${commerceErrorMessage(cause)}`);
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
    <section className={styles.panel} aria-label="供应商测试应付对账单">
      <h2>供货应付对账单 · TEST</h2>
      <p className={styles.small}>
        只读测试账本：采购成本应付与退款冲回，不是到期可付款金额，不代表已付款或银行到账。这里没有提现或供应商打款操作。
      </p>
      <form onSubmit={search} className={styles.actions} style={{ alignItems: "center" }}>
        <label className={styles.field}>
          对账供应商
          <select name="supplierId" aria-label="对账供应商" required disabled={busy}>
            {suppliers.map((supplier) => (
              <option key={supplier.id} value={supplier.id}>
                {supplier.name}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          起始时刻
          <input name="from" aria-label="对账起始时刻" type="datetime-local" disabled={busy} />
        </label>
        <label className={styles.field}>
          结束时刻
          <input name="to" aria-label="对账结束时刻" type="datetime-local" disabled={busy} />
        </label>
        <button className={styles.secondary} disabled={busy || !suppliers.length}>
          查询供货应付对账单
        </button>
      </form>
      <p className={styles.small}>
        时间按浏览器本地时区输入，查询转为
        UTC；结束时刻不包含。留空从最早记录查至服务器当前时刻，后续分页固定该结束边界。
      </p>
      {busy ? <p role="status">正在读取测试对账单…</p> : null}
      {error ? (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      ) : null}
      {!statement && !busy && !error ? (
        <p className={styles.muted}>请选择供应商和范围查询，尚未读取应付金额。</p>
      ) : null}
      {statement ? (
        <>
          <h3>{statement.supplier.name} · 只读测试应付</h3>
          <p className={styles.small}>
            已查询 UTC 范围：{statement.period.from ?? "最早记录"} 至 {statement.period.to}（不含）
          </p>
          <p>
            期初应付 {cad(statement.summary.openingCents)} · 采购应付增加{" "}
            {cad(statement.summary.accruedCents)} · 退款冲回 {cad(statement.summary.reversedCents)}{" "}
            · 未分类变动 {cad(statement.summary.unclassifiedCents)} · 期末应付{" "}
            {cad(statement.summary.closingCents)}
          </p>
          <p className={styles.small}>
            对账差额 {cad(statement.summary.equationDifferenceCents)} · 未分类流水{" "}
            {statement.summary.unclassifiedEntries} 条 ·{" "}
            {statement.summary.reconciliationOk
              ? "账内等式核对一致"
              : "存在未分类或对账异常，待人工核实"}
          </p>
          {statement.summary.hasUnresolvedRefunds ? (
            <p className={styles.notice}>
              仍有退款结果或商品归属待核实，不能把此应付当作最终可付款金额。
            </p>
          ) : null}
          <div style={{ overflowX: "auto" }}>
            <table className={styles.supplierTable}>
              <thead>
                <tr>
                  <th>事件 / 时间</th>
                  <th>应付变动</th>
                  <th>历史成本快照 / 追踪</th>
                </tr>
              </thead>
              <tbody>
                {statement.rows.map((row) => (
                  <tr key={row.eventKey}>
                    <td>
                      {kindLabels[row.kind]}
                      <small className={styles.small}>
                        {row.createdAt}
                        <br />
                        {row.eventKey}
                      </small>
                    </td>
                    <td>{cad(row.amountCents)}</td>
                    <td>
                      {row.items.map((item) => (
                        <p key={item.itemId}>
                          {item.name} · {item.sku ?? "历史订单未记录 SKU"} × {item.quantity} ·
                          单位采购成本 {cad(item.unitCostCents)} · 成本快照合计{" "}
                          {cad(item.totalCostCents)}
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
          {!statement.rows.length ? <p>当前查询范围没有应付流水。</p> : null}
          <div className={styles.actions}>
            <button
              className={styles.secondary}
              disabled={busy || statement.page === 0}
              onClick={() => page(statement.page - 1)}
            >
              上一页对账单
            </button>
            <span>
              第 {statement.page + 1} 页 · 共 {statement.totalRows} 条分录
            </span>
            <button
              className={styles.secondary}
              disabled={busy || !statement.hasMore}
              onClick={() => page(statement.page + 1)}
            >
              下一页对账单
            </button>
          </div>
          <p className={styles.small}>
            付款形成的采购应付可合并多件商品，以上成本是历史快照，不把整单分录金额分摊成单项退款。生成时间{" "}
            {statement.generatedAt}；结算资格未评估。
          </p>
        </>
      ) : null}
    </section>
  );
}
