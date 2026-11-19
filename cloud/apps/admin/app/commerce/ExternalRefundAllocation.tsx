"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type {
  CommerceExternalRefund,
  CommerceExternalRefundDetail,
  CommerceExternalRefundAllocationResult,
  CommercePaymentStatus,
} from "@synara/contracts/cloud";
import { admin, AdminApiError, getAdminSessionRevision } from "@/lib/api";

const button = "rounded-lg border border-border bg-card px-4 py-2 text-sm disabled:opacity-40";
const primary = "rounded-lg bg-emerald-900 px-4 py-2 text-sm text-white disabled:opacity-40";
const money = (cents: number) => `CAD ${(cents / 100).toFixed(2)}`;
const providerLabels = {
  unknown: "渠道结果未知",
  pending: "渠道处理中",
  requires_action: "渠道待处理",
  succeeded: "渠道已确认退款成功（TEST）",
  failed: "渠道退款失败",
  canceled: "渠道退款已取消",
};
const allocationLabels = {
  unallocated: "尚未归属商品",
  allocated: "已登记商品归属",
  excluded_owned: "已关联原平台退款，不重复登记",
  requires_review: "异常待核实",
};
const externalErrors: Readonly<Record<string, string>> = {
  commerce_external_refund_not_found: "未找到这笔外部退款，请刷新列表核对。",
  commerce_external_refund_owned: "这笔退款已关联原有平台退款，不应重复登记。",
  commerce_external_refund_allocated:
    "这笔退款已有不同的商品归属记录，不能重复核销，请刷新详情核对。",
  commerce_external_refund_stale:
    "退款或异常记录在核实时发生变化，请刷新详情重新核对，不能按旧数据重复登记。",
  commerce_external_refund_unconfirmed:
    "渠道尚未确认退款成功，不能核销；账本和现有冻结状态保持不变。",
  commerce_external_refund_blocked:
    "当前订单的退款、付款或来源状态仍需核实，暂时不能核销，请刷新详情核对。",
  commerce_external_refund_proof_unavailable:
    "暂时无法从渠道核实退款，账本和现有冻结状态未改变；请稍后查询，不要再次退款。",
};

/** Decimal CAD input is converted exactly, never through floating-point multiplication. */
export function parseAllocationCents(raw: string): number | null {
  const text = raw.trim();
  if (!text) return 0;
  const match = /^(0|[1-9]\d{0,7})(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) return null;
  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
}

export function ExternalRefundAllocation({
  orderId,
  disabled,
  canWrite = true,
  onPayment,
  onOrderChanged,
}: {
  orderId: string;
  disabled: boolean;
  canWrite?: boolean;
  onPayment: (payment: CommercePaymentStatus) => void;
  onOrderChanged: () => Promise<void>;
}) {
  const [refunds, setRefunds] = useState<CommerceExternalRefund[] | null>(null);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [gatewayEnabled, setGatewayEnabled] = useState(false);
  const [detail, setDetail] = useState<CommerceExternalRefundDetail | null>(null);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const keys = useRef(new Map<string, string>());
  const locked = busy || disabled;
  const session = getAdminSessionRevision();
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const active = () => mounted.current && session === getAdminSessionRevision();
  async function loadList(next = page) {
    if (!active()) return;
    const result = await admin<{
      refunds: CommerceExternalRefund[];
      enabled: boolean;
      page: number;
      hasMore: boolean;
    }>(
      `/commerce/orders/${encodeURIComponent(orderId)}/external-refunds${next ? `?page=${next}` : ""}`,
    );
    if (!active()) return;
    setRefunds(result.refunds);
    setGatewayEnabled(result.enabled);
    setPage(result.page);
    setHasMore(result.hasMore);
  }
  function showDetail(result: CommerceExternalRefundDetail) {
    if (!active()) return;
    if (result.refund.orderId !== orderId) {
      setDetail(null);
      setMessage(
        `这笔退款属于其他订单 ${result.refund.orderId}，请在对应订单处理；没有在当前订单分配。`,
      );
      return;
    }
    setDetail(result);
    setAmounts({});
    setReason("");
    setConfirmed(false);
    setUncertain(false);
    onPayment(result.payment);
  }
  async function action(work: () => Promise<void>, financial = false) {
    if (!active() || locked) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await work();
    } catch (cause) {
      if (!active()) return;
      if (financial) setUncertain(true);
      setError(
        cause instanceof AdminApiError && externalErrors[cause.code]
          ? externalErrors[cause.code]!
          : cause instanceof TypeError
            ? financial
              ? "核销请求结果暂未确认，请先刷新详情核对；原样重试会复用请求编号，不会再次发起渠道退款。"
              : "暂时无法连接退款记录服务，请稍后查询。"
            : cause instanceof Error
              ? cause.message
              : "操作未能完成，请刷新详情核对。",
      );
    } finally {
      if (active()) setBusy(false);
    }
  }
  const values =
    detail?.items.map((item) => ({
      item,
      cents: parseAllocationCents(amounts[item.itemId] ?? ""),
    })) ?? [];
  const invalid = values.some(({ item, cents }) => cents === null || cents > item.remainingCents);
  const total = values.reduce((sum, { cents }) => sum + (cents ?? 0), 0);
  const difference = detail ? detail.refund.amountCents - total : 0;
  const eligible = Boolean(
    detail?.enabled && detail.canAllocate && detail.refund.providerStatus === "succeeded",
  );
  async function allocate(event: FormEvent) {
    event.preventDefault();
    if (!active() || !canWrite) return;
    if (!detail || !eligible || invalid || difference !== 0 || !reason.trim() || !confirmed) return;
    const allocations = values
      .filter(({ cents }) => cents! > 0)
      .map(({ item, cents }) => ({ itemId: item.itemId, amountCents: cents! }));
    const input = { expectedVersion: detail.refund.version, allocations, reason: reason.trim() };
    const signature = JSON.stringify({ refundId: detail.refund.id, ...input });
    if (!keys.current.has(signature)) keys.current.set(signature, crypto.randomUUID());
    await action(async () => {
      const result = await admin<CommerceExternalRefundAllocationResult>(
        `/commerce/external-refunds/${encodeURIComponent(detail.refund.id)}/allocate`,
        { method: "POST", json: { ...input, idempotencyKey: keys.current.get(signature)! } },
      );
      if (!active()) return;
      onPayment(result.payment);
      setDetail({
        ...detail,
        refund: result.refund,
        payment: result.payment,
        canAllocate: false,
        message: result.message,
      });
      setRefunds(
        (current) =>
          current?.map((refund) => (refund.id === result.refund.id ? result.refund : refund)) ??
          null,
      );
      setUncertain(false);
      setMessage(
        `${result.applied ? "已有渠道退款的商品归属已登记，未再次发起退款。" : "登记结果已返回，请以服务器记录为准。"}${result.reviewCleared ? "相关付款异常已由服务器重新核验。" : "仍有其他待核实事项，不能视为异常全部解除。"}售后仍需按原流程另行核实关闭；不代表真实资金到账。`,
      );
      try {
        await onOrderChanged();
        if (!active()) return;
        await loadList();
        if (!active()) return;
        showDetail(
          await admin<CommerceExternalRefundDetail>(
            `/commerce/external-refunds/${encodeURIComponent(detail.refund.id)}`,
          ),
        );
      } catch {
        if (active())
          setError(
            "服务器已返回核销登记结果，但刷新记录暂未完成，请重新查询详情，不要再次发起渠道退款。",
          );
      }
    }, true);
  }
  const Detail = canWrite ? "form" : "section";
  return (
    <section
      className="mt-4 space-y-3 rounded-xl border border-border bg-background p-4"
      aria-label="已发生的外部退款归属"
    >
      <h4 className="font-semibold">已发生的渠道退款 · 商品归属核销</h4>
      <p className="text-sm">
        这里只登记已有退款归属，不会再次向渠道发起退款。未成功、金额未核实或渠道未启用时只能查看。
      </p>
      <button className={button} disabled={locked} onClick={() => void action(() => loadList())}>
        查询外部退款记录
      </button>
      {refunds === null ? (
        <p className="text-xs text-muted-foreground">
          尚未查询外部退款；“需人工核实”不等于已完成退款或核销。
        </p>
      ) : (
        <>
          {!refunds.length ? (
            <p className="text-sm">
              当前页没有已登记外部退款。
              {canWrite ? "若是历史异常，可使用已有验签事件查询登记，不能手填退款金额。" : null}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr>
                    <th className="p-2">渠道退款编号</th>
                    <th>金额</th>
                    <th>渠道状态 / 商品归属</th>
                    <th>核对</th>
                  </tr>
                </thead>
                <tbody>
                  {refunds.map((refund) => (
                    <tr className="border-t border-border" key={refund.id}>
                      <td className="p-2 font-mono text-xs">{refund.providerRefundId}</td>
                      <td>{money(refund.amountCents)}</td>
                      <td>
                        {providerLabels[refund.providerStatus]}
                        <small className="block">{allocationLabels[refund.allocationState]}</small>
                      </td>
                      <td>
                        <button
                          className={button}
                          disabled={locked}
                          onClick={() =>
                            void action(async () =>
                              showDetail(
                                await admin<CommerceExternalRefundDetail>(
                                  `/commerce/external-refunds/${encodeURIComponent(refund.id)}`,
                                ),
                              ),
                            )
                          }
                        >
                          查看退款归属详情
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="flex items-center gap-3">
            <button
              className={button}
              disabled={locked || page === 0}
              onClick={() => void action(() => loadList(page - 1))}
            >
              上一页外部退款
            </button>
            <span className="text-xs">第 {page + 1} 页</span>
            <button
              className={button}
              disabled={locked || !hasMore}
              onClick={() => void action(() => loadList(page + 1))}
            >
              下一页外部退款
            </button>
          </div>
          {canWrite ? (
            <details>
              <summary className="cursor-pointer text-sm">登记已有验签退款事件（历史异常）</summary>
              <form
                className="mt-3 flex flex-wrap gap-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!active() || !canWrite) return;
                  const data = new FormData(event.currentTarget);
                  void action(async () => {
                    const result = await admin<CommerceExternalRefundDetail>(
                      "/commerce/external-refunds/observe",
                      {
                        method: "POST",
                        json: {
                          sourceEventId: String(data.get("sourceEventId") ?? "").trim(),
                          reason: String(data.get("reason") ?? "").trim(),
                        },
                      },
                    );
                    if (!active()) return;
                    showDetail(result);
                    await loadList();
                  });
                }}
              >
                <label className="text-xs">
                  已验签事件编号
                  <input
                    className="mt-1 block rounded border border-border bg-background p-2"
                    name="sourceEventId"
                    required
                    pattern="evt_[A-Za-z0-9_]+"
                    placeholder="evt_…"
                  />
                </label>
                <label className="text-xs">
                  登记原因
                  <input
                    className="mt-1 block rounded border border-border bg-background p-2"
                    name="reason"
                    required
                    maxLength={500}
                  />
                </label>
                <button className={button} disabled={locked || !gatewayEnabled}>
                  从渠道核实并登记已有事件
                </button>
              </form>
              <p className="mt-2 text-xs text-muted-foreground">
                只能引用服务器已有验签记录。退款编号、金额及渠道状态由服务器重新查询，不会创建退款。
              </p>
            </details>
          ) : null}
        </>
      )}
      {detail ? (
        <Detail
          onSubmit={canWrite ? (event) => void allocate(event) : undefined}
          className="space-y-3 rounded-lg border border-border p-4"
          aria-label={canWrite ? "核销已有渠道退款" : "已有渠道退款归属详情"}
        >
          <h4 className="font-semibold">核对退款 {detail.refund.providerRefundId}</h4>
          <p className="text-xs text-muted-foreground">
            来源验签事件 {detail.refund.sourceEventId} · 记录版本 {detail.refund.version}
          </p>
          <p className="text-sm">
            渠道记录金额 {money(detail.refund.amountCents)} ·{" "}
            {providerLabels[detail.refund.providerStatus]} ·{" "}
            {allocationLabels[detail.refund.allocationState]}
          </p>
          <button
            type="button"
            className={button}
            disabled={locked}
            onClick={() =>
              void action(async () =>
                showDetail(
                  await admin<CommerceExternalRefundDetail>(
                    `/commerce/external-refunds/${encodeURIComponent(detail.refund.id)}`,
                  ),
                ),
              )
            }
          >
            刷新退款归属详情
          </button>
          <p className="text-xs text-muted-foreground">{detail.message}</p>
          {detail.refund.allocations.length ? (
            <ul className="text-sm">
              {detail.refund.allocations.map((allocation) => (
                <li key={allocation.itemId}>
                  商品 {allocation.itemId} · 已归属 {money(allocation.amountCents)} · 商品累计退款{" "}
                  {money(allocation.refundedAfterCents)}
                </li>
              ))}
            </ul>
          ) : null}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr>
                  <th className="p-2">订单商品 / SKU</th>
                  <th>尚可归属金额</th>
                  {canWrite ? <th>本次归属金额（CAD）</th> : null}
                </tr>
              </thead>
              <tbody>
                {detail.items.map((item) => (
                  <tr className="border-t border-border" key={item.itemId}>
                    <td className="p-2">
                      {item.name}
                      <small className="block font-mono">{item.sku ?? "历史订单未记录 SKU"}</small>
                    </td>
                    <td>{money(item.remainingCents)}</td>
                    {canWrite ? (
                      <td>
                        <input
                          className="w-32 rounded border border-border bg-background p-2"
                          aria-label={`${item.name}（${item.sku ?? item.itemId}）核销金额`}
                          name={item.itemId}
                          inputMode="decimal"
                          value={
                            detail.refund.allocationState === "allocated"
                              ? (
                                  (detail.refund.allocations.find(
                                    (allocation) => allocation.itemId === item.itemId,
                                  )?.amountCents ?? 0) / 100
                                ).toFixed(2)
                              : (amounts[item.itemId] ?? "")
                          }
                          placeholder="0.00"
                          disabled={locked || !eligible || uncertain}
                          onChange={(event) =>
                            setAmounts((current) => ({
                              ...current,
                              [item.itemId]: event.target.value,
                            }))
                          }
                        />
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {detail.refund.allocationState === "allocated" || canWrite ? (
            <p className="text-sm">
              {detail.refund.allocationState === "allocated" ? (
                `已登记归属合计 ${money(detail.refund.allocations.reduce((sum, allocation) => sum + allocation.amountCents, 0))}`
              ) : (
                <>
                  本次分配合计 {money(total)} ·{" "}
                  {invalid
                    ? "金额格式错误或超过商品尚可归属金额"
                    : difference === 0
                      ? "合计与渠道退款一致"
                      : difference > 0
                        ? `还差 ${money(difference)}`
                        : `超出 ${money(-difference)}`}
                </>
              )}
            </p>
          ) : null}
          {canWrite ? (
            <>
              <label className="block text-sm">
                核销原因
                <input
                  className="mt-1 block w-full rounded border border-border bg-background p-2"
                  name="reason"
                  required
                  maxLength={500}
                  value={reason}
                  disabled={locked || !eligible || uncertain}
                  onChange={(event) => setReason(event.target.value)}
                />
              </label>
              <label className="flex gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={confirmed}
                  disabled={locked || !eligible || uncertain}
                  onChange={(event) => setConfirmed(event.target.checked)}
                />
                我确认只登记已发生的退款归属，不再次退款；售后需另行核实关闭。
              </label>
              {!eligible ? (
                <p className="text-sm text-amber-900">
                  当前只能查看，服务器未允许核销；渠道必须确认成功，且退款尚可分配。
                </p>
              ) : null}
              {uncertain ? (
                <p className="text-sm text-amber-900">
                  上次登记结果待确认，请先刷新详情。原样重试将复用同一请求编号，不会创建新的渠道退款。
                </p>
              ) : null}
              <button
                className={primary}
                disabled={
                  locked || !eligible || invalid || difference !== 0 || !reason.trim() || !confirmed
                }
              >
                确认登记已有退款归属（不再次退款）
              </button>
            </>
          ) : null}
        </Detail>
      ) : null}
      {message ? (
        <p className="text-sm text-emerald-900" role="status">
          {message}
        </p>
      ) : null}
      {error ? (
        <p className="text-sm text-red-800" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
