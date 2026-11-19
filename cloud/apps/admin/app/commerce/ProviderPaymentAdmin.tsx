"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { CommercePaymentStatus } from "@synara/contracts/cloud";
import { admin, getAdminSessionRevision } from "@/lib/api";
import { ExternalRefundAllocation } from "./ExternalRefundAllocation";

const labels: Record<CommercePaymentStatus["status"], string> = {
  not_started: "未创建收银台",
  creating: "正在创建收银台",
  open: "收银台待付款",
  unknown: "付款结果未知，待核实",
  cancel_requested: "正在关闭并核实收银台",
  paid: "渠道测试付款已确认",
  expired_unpaid: "已确认未付款并关闭",
  failed: "渠道操作失败",
  requires_review: "支付异常，需人工核实",
};
const refundLabels = {
  submitting: "提交中，未确认成功",
  unknown: "结果未知，禁止直接重付",
  pending: "渠道处理中",
  succeeded: "渠道测试退款已确认",
  failed: "退款失败",
  requires_review: "退款异常，需核实",
};
const button = "rounded-lg border border-border bg-card px-4 py-2 text-sm disabled:opacity-40";

export function ProviderPaymentAdmin({
  orderId,
  payment,
  onPayment,
  onOrderChanged,
  disabled,
  canWrite = true,
}: {
  orderId: string;
  payment: CommercePaymentStatus | undefined;
  onPayment: (payment: CommercePaymentStatus) => void;
  onOrderChanged: () => Promise<void>;
  disabled: boolean;
  canWrite?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const session = getAdminSessionRevision();
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const active = () => mounted.current && session === getAdminSessionRevision();
  async function action(work: () => Promise<CommercePaymentStatus>) {
    if (!active() || busy || disabled) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await work();
      if (!active()) return;
      onPayment(result);
      await onOrderChanged();
      if (active()) setMessage("服务器渠道状态已刷新；未知或处理中不代表付款、退款已成功。");
    } catch (cause) {
      if (!active()) return;
      setError(
        cause instanceof TypeError
          ? "暂时无法连接商城管理服务，请稍后重试。"
          : cause instanceof Error
            ? cause.message
            : "查询失败",
      );
    } finally {
      if (active()) setBusy(false);
    }
  }
  function reconcile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!active() || !canWrite) return;
    if (payment?.enabled !== true) {
      setError("渠道测试配置尚未启用，只能查询历史状态。");
      return;
    }
    const reason = String(new FormData(event.currentTarget).get("reason") ?? "").trim();
    void action(
      async () =>
        (
          await admin<{ payment: CommercePaymentStatus }>(
            `/commerce/orders/${encodeURIComponent(orderId)}/payment/reconcile`,
            { method: "POST", json: { reason } },
          )
        ).payment,
    );
  }
  return (
    <section
      className="mt-4 space-y-3 rounded-xl border border-amber-200 bg-amber-50/40 p-4"
      aria-label="渠道测试支付核验"
    >
      <h3 className="font-semibold">Stripe TEST 渠道状态</h3>
      {payment?.enabled === false ? (
        <p className="text-sm">渠道测试配置未启用，只读历史状态；不能创建退款或核实渠道操作。</p>
      ) : null}
      <p className="text-sm">
        {payment ? labels[payment.status] : "尚未查询；提交渠道退款前必须先核实服务器支付状态。"}
      </p>
      <button
        className={button}
        disabled={busy || disabled}
        onClick={() =>
          void action(
            async () =>
              (
                await admin<{ payment: CommercePaymentStatus }>(
                  `/commerce/orders/${encodeURIComponent(orderId)}/payment`,
                )
              ).payment,
          )
        }
      >
        查询渠道测试状态
      </button>
      {canWrite ? (
        <form className="flex flex-wrap gap-3" onSubmit={reconcile}>
          <input
            className="rounded border border-border bg-background px-3 py-2 text-sm"
            aria-label="渠道核实原因"
            name="reason"
            required
            maxLength={500}
            placeholder="核实渠道测试结果的原因"
          />
          <button className={button} disabled={busy || disabled || payment?.enabled !== true}>
            核实并同步渠道测试结果
          </button>
        </form>
      ) : (
        <p className="text-sm">当前账号只能查看渠道测试状态，不能同步渠道结果或登记退款。</p>
      )}
      <p className="text-xs text-muted-foreground">
        这里只处理 Stripe
        TEST。未知状态要先查询与核实，不能再次创建付款或盲目重退；真实收退款和银行打款仍关闭。
      </p>
      {payment?.refunds.map((refund) => (
        <p className="text-sm" key={refund.id}>
          退款商品 {refund.itemId} · CAD {(refund.amountCents / 100).toFixed(2)} ·{" "}
          {refundLabels[refund.status]}
        </p>
      ))}
      <ExternalRefundAllocation
        orderId={orderId}
        disabled={busy || disabled}
        canWrite={canWrite}
        onPayment={onPayment}
        onOrderChanged={onOrderChanged}
      />
      {message ? (
        <p role="status" className="text-sm text-emerald-900">
          {message}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-red-800">
          {error}
        </p>
      ) : null}
    </section>
  );
}
