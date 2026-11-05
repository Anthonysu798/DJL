"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { CommerceOrder, CommercePaymentStatus } from "@synara/contracts/cloud";

import { commerce, commerceErrorMessage, cad } from "@/lib/commerce";
import { openCommerceCheckout, stripeTestCheckoutUrl } from "@/lib/commerce-checkout";
import styles from "./shop.module.css";

const statuses: Record<CommercePaymentStatus["status"], string> = {
  not_started: "尚未创建测试收银台",
  creating: "正在创建测试收银台",
  open: "测试收银台待付款",
  unknown: "付款结果待核实",
  cancel_requested: "正在核实关闭收银台",
  paid: "服务器已确认测试付款",
  expired_unpaid: "服务器已确认未付款并关闭",
  failed: "测试支付操作失败",
  requires_review: "支付异常，等待平台核实",
};
const refundStatuses = {
  submitting: "正在提交退款",
  unknown: "退款结果待核实",
  pending: "退款处理中",
  succeeded: "测试退款已确认",
  failed: "退款失败",
  requires_review: "退款异常，等待核实",
};

/** URL redirects never settle an order. Status reads are authenticated server snapshots. */
export function HostedPayment({
  order,
  disabled,
  enabled,
  onOrderChanged,
}: {
  order: CommerceOrder;
  disabled: boolean;
  /** Overall commerce test mode; the server separately proves gateway availability. */
  enabled: boolean;
  onOrderChanged: () => Promise<void>;
}) {
  const [payment, setPayment] = useState<CommercePaymentStatus | null>(null);
  const [capabilityConfirmed, setCapabilityConfirmed] = useState(false);
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [watching, setWatching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const checkoutKey = useRef<string | null>(null);
  const cancelKey = useRef<string | null>(null);
  const reading = useRef(false);
  const save = (next: CommercePaymentStatus) => {
    setPayment(next);
    setCapabilityConfirmed(true);
    setCheckoutUrl(
      next.enabled === true ? stripeTestCheckoutUrl(next.checkoutUrl, next.sessionId) : null,
    );
    if (["paid", "expired_unpaid", "failed", "requires_review"].includes(next.status))
      setWatching(false);
  };
  const readPayment = async () => {
    setCapabilityConfirmed(false);
    const { payment: current } = await commerce.payment(order.id);
    save(current);
    return current;
  };
  const read = async () => {
    if (reading.current) return;
    reading.current = true;
    try {
      await readPayment();
      await onOrderChanged();
    } finally {
      reading.current = false;
    }
  };
  const poll = useEffectEvent(() => {
    if (document.visibilityState === "visible")
      void read().catch((cause) => setError(commerceErrorMessage(cause)));
  });
  useEffect(() => {
    if (!watching) return;
    const timer = window.setInterval(() => poll(), 4000);
    const stop = window.setTimeout(() => setWatching(false), 60_000);
    const focus = () => poll();
    window.addEventListener("focus", focus);
    document.addEventListener("visibilitychange", focus);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(stop);
      window.removeEventListener("focus", focus);
      document.removeEventListener("visibilitychange", focus);
    };
  }, [watching]);
  async function action(work: () => Promise<void>) {
    if (working || disabled) return;
    setWorking(true);
    setError(null);
    setMessage(null);
    try {
      await work();
    } catch (cause) {
      setError(commerceErrorMessage(cause));
    } finally {
      setWorking(false);
    }
  }
  const blocked = disabled || working;
  const unstarted = payment?.status === "not_started" && payment.attemptId === null;
  return (
    <section className={styles.panel} aria-label="Stripe 测试支付">
      <strong>Stripe 测试收银台</strong>
      <p className={styles.small}>
        仅使用测试卡，不要输入真实银行卡。收银台单独打开；返回页面或网址参数不代表付款成功。
      </p>
      {!enabled || payment?.enabled === false ? (
        <p className={styles.notice}>渠道测试付款暂未启用或已暂停，仍可查询服务器历史状态。</p>
      ) : null}
      <p role="status">
        {payment ? statuses[payment.status] : "支付状态尚未查询，请以服务器记录为准。"}
      </p>
      {!capabilityConfirmed ? (
        <p className={styles.small}>
          请先查询服务器支付状态，确认渠道测试付款可用后再准备或打开收银台。
        </p>
      ) : null}
      {payment &&
      ["unknown", "creating", "cancel_requested", "requires_review"].includes(payment.status) ? (
        <p className={styles.notice}>
          结果尚未确定，库存和账务以服务器处理为准；请勿重复付款，不能把等待或超时当作成功。
        </p>
      ) : null}
      <div className={styles.actions}>
        {order.status === "awaiting_payment" &&
        (!payment || ["not_started", "open"].includes(payment.status)) ? (
          <button
            className={styles.primary}
            disabled={blocked || !enabled || !capabilityConfirmed || payment?.enabled !== true}
            onClick={() =>
              void action(async () => {
                const current = await readPayment();
                if (current.enabled !== true)
                  throw new Error("渠道测试付款暂未启用，请联系平台核实配置；不会转成模拟付款。");
                if (!["not_started", "open"].includes(current.status)) {
                  await onOrderChanged();
                  return;
                }
                if (current.status === "open") {
                  if (!stripeTestCheckoutUrl(current.checkoutUrl, current.sessionId))
                    throw new Error("服务器未返回可验证的测试收银台，请查询支付状态。");
                  setMessage(
                    "测试收银台已准备好。请点击打开按钮，在独立页面完成测试付款后查询结果。",
                  );
                  return;
                }
                checkoutKey.current ??= crypto.randomUUID();
                const result = await commerce.checkout(order.id, checkoutKey.current);
                save(result.payment);
                const url = stripeTestCheckoutUrl(
                  result.checkoutUrl ?? result.payment.checkoutUrl,
                  result.payment.sessionId,
                );
                setCheckoutUrl(url);
                if (result.payment.status === "open" && !url)
                  throw new Error(
                    "服务器未返回可验证的 Stripe 测试收银台，请查询支付状态，不要重复付款。",
                  );
                if (result.payment.status === "open")
                  setMessage(
                    "测试收银台已准备好。请点击打开按钮，在独立页面完成测试付款后查询结果。",
                  );
                await onOrderChanged();
              })
            }
          >
            {checkoutUrl ? "重新获取现有测试收银台" : "准备 Stripe 测试付款"}
          </button>
        ) : null}
        {payment?.status === "open" && payment.enabled === true && checkoutUrl ? (
          <button
            className={styles.primary}
            disabled={blocked || !enabled || !capabilityConfirmed}
            onClick={() =>
              void action(async () => {
                await openCommerceCheckout({
                  orderId: order.id,
                  attemptId: payment.attemptId,
                  sessionId: payment.sessionId,
                  checkoutUrl,
                });
                setWatching(true);
                setMessage(
                  "请在独立测试收银台操作；若未弹出，请允许弹窗后重试。完成后返回此处查询服务器结果。",
                );
              })
            }
          >
            打开 Stripe 测试收银台 ↗
          </button>
        ) : null}
        <button
          className={styles.secondary}
          disabled={blocked}
          onClick={() =>
            void action(async () => {
              await read();
              setMessage("服务器支付状态已刷新。不会根据返回网址确认付款。");
            })
          }
        >
          查询服务器支付状态
        </button>
        {order.status === "awaiting_payment" &&
        !["paid", "expired_unpaid"].includes(payment?.status ?? "") ? (
          <button
            className={styles.secondary}
            disabled={
              blocked ||
              !enabled ||
              (payment?.enabled === false && !unstarted) ||
              payment?.status === "cancel_requested"
            }
            onClick={() =>
              void action(async () => {
                const current = await readPayment();
                if (["paid", "expired_unpaid"].includes(current.status)) {
                  await onOrderChanged();
                  return;
                }
                if (
                  current.enabled !== true &&
                  !(current.status === "not_started" && current.attemptId === null)
                )
                  throw new Error("渠道测试配置尚未启用，只能查询已有付款状态，请联系平台处理。");
                cancelKey.current ??= crypto.randomUUID();
                const result = await commerce.cancelCheckout(order.id, cancelKey.current);
                save(result.payment);
                await onOrderChanged();
                setMessage(
                  result.payment.status === "not_started" && result.payment.attemptId === null
                    ? "订单取消结果已刷新，请以服务器订单状态为准。"
                    : result.payment.status === "expired_unpaid"
                      ? "服务器已确认收银台未付款并关闭，订单状态已刷新。"
                      : "已提交关闭请求，结果尚需核实；不代表订单已取消或库存已释放。",
                );
              })
            }
          >
            申请关闭测试收银台
          </button>
        ) : null}
      </div>
      {watching ? (
        <p className={styles.small}>
          正在限时查询服务器状态；返回此窗口时也会刷新。超过一分钟后可手动继续查询。
        </p>
      ) : null}
      {payment?.refunds.length ? (
        <div>
          <h4>渠道测试退款</h4>
          {payment.refunds.map((refund) => (
            <p key={refund.id} className={styles.small}>
              {cad(refund.amountCents)} · {refundStatuses[refund.status]}
              {refund.status !== "succeeded" ? "（尚未确认退款成功）" : "（非真实资金）"}
            </p>
          ))}
        </div>
      ) : null}
      {message ? (
        <p className={styles.notice} role="status">
          {message}
        </p>
      ) : null}
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
