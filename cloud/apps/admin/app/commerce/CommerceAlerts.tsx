"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import type {
  CommerceAlertKind,
  CommerceAlertsResponse,
  CommerceAlertEmailDelivery,
} from "@synara/contracts/cloud";
import { admin, AdminApiError, getToken } from "@/lib/api";

const button = "rounded-lg border border-border bg-card px-4 py-2 text-sm disabled:opacity-40";
const labels: Record<CommerceAlertKind, string> = {
  payment_unresolved: "付款结果持续未确认",
  payment_review: "付款需要人工复核",
  refund_unresolved: "退款结果持续未确认",
  refund_review: "退款需要人工复核",
  refund_pending: "渠道退款持续处理中",
  event_unprocessed: "付款事件尚未处理完成",
  event_review_unmapped: "付款事件无法归属，需人工核查",
  external_refund_unresolved: "外部退款归属或渠道结果待核实",
  withdrawal_requested: "提现申请需要跟进",
  withdrawal_approved: "已批准提现需要跟进核实",
};
const healthLabels: Record<CommerceAlertsResponse["monitor"]["status"], string> = {
  disabled: "监控未启用，不能判断当前是否存在新异常。",
  never_scanned: "尚无成功扫描记录，不能判断当前是否存在异常。",
  stale: "扫描记录已过期，请核查后台任务；不能把旧结果当作当前健康。",
  healthy: "最近一次扫描正常完成；不代表所有订单或财务结果正常。",
};
type Filter = "open" | "resolved" | "all";
const deliveryLabels: Record<CommerceAlertEmailDelivery["state"], string> = {
  pending: "等待处理",
  submitting: "请求提交中，尚未确认",
  accepted: "服务商已接受请求，不代表收件确认",
  simulated: "模拟记录，未发送邮件",
  needs_review: "发送结果需人工复核，不会自动重发",
  skipped_resolved: "异常已恢复，已跳过发送",
};

export function CommerceAlerts({
  onOrder,
  onWithdrawal,
  disabled = false,
}: {
  onOrder: (id: string) => Promise<void>;
  onWithdrawal?: ((id: string) => Promise<void>) | undefined;
  disabled?: boolean;
}) {
  const actor = getToken();
  const [storedData, setData] = useState<CommerceAlertsResponse | null>(null);
  const dataActor = useRef(actor);
  const generation = useRef(0);
  const lifecycle = useRef({ active: true });
  const working = useRef(false);
  const data = dataActor.current === actor ? storedData : null;
  const [filter, setFilter] = useState<Filter>("open");
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function load(nextFilter: Filter, nextCursors: (string | null)[], nextPage: number) {
    if (working.current) return;
    const request = ++generation.current;
    const owner = getToken();
    const scope = lifecycle.current;
    const sameRequest = () =>
      generation.current === request && scope.active && lifecycle.current === scope;
    const current = () => sameRequest() && getToken() === owner;
    working.current = true;
    setBusy(true);
    setError(null);
    setData(null);
    const query = new URLSearchParams();
    if (nextFilter !== "open") query.set("status", nextFilter);
    if (nextCursors[nextPage]) query.set("cursor", nextCursors[nextPage]!);
    try {
      const result = await admin<CommerceAlertsResponse>(
        `/commerce/alerts${query.size ? `?${query}` : ""}`,
      );
      if (!current()) return;
      dataActor.current = owner;
      setData(result);
      setFilter(nextFilter);
      setCursors(nextCursors);
      setPage(nextPage);
    } catch (cause) {
      if (
        sameRequest() &&
        cause instanceof AdminApiError &&
        cause.status === 401 &&
        getToken() === null
      ) {
        working.current = false;
        setData(null);
        setBusy(false);
        setError("管理员登录已失效，请重新确认登录；没有已确认的监控结果。");
        return;
      }
      if (!current()) return;
      setError(
        `告警查询失败，不能据此判断没有异常。${cause instanceof TypeError ? "暂时无法连接管理服务。" : cause instanceof Error ? cause.message : "请稍后重试。"}`,
      );
    } finally {
      if (current()) {
        working.current = false;
        setBusy(false);
      }
    }
  }
  const refresh = useEffectEvent(() => load(filter, cursors, page));
  useEffect(() => {
    const scope = { active: true };
    lifecycle.current = scope;
    working.current = false;
    setData(null);
    setError(null);
    setBusy(false);
    void refresh();
    const timer = setInterval(() => {
      void refresh();
    }, 60_000);
    return () => {
      clearInterval(timer);
      scope.active = false;
      working.current = false;
    };
  }, [actor]);
  async function locate(work: () => Promise<void>) {
    if (working.current || disabled) return;
    const request = ++generation.current;
    const owner = getToken();
    const scope = lifecycle.current;
    const sameRequest = () =>
      generation.current === request && scope.active && lifecycle.current === scope;
    const current = () => sameRequest() && getToken() === owner;
    working.current = true;
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (cause) {
      if (
        sameRequest() &&
        cause instanceof AdminApiError &&
        cause.status === 401 &&
        getToken() === null
      ) {
        working.current = false;
        setData(null);
        setBusy(false);
        setError("管理员登录已失效，未进入处理页面，请重新确认登录。");
        return;
      }
      if (!current()) return;
      setError(
        `定位失败，未进入处理页面。${cause instanceof TypeError ? "暂时无法连接管理服务。" : cause instanceof Error ? cause.message : "请重试。"}`,
      );
    } finally {
      if (current()) {
        working.current = false;
        setBusy(false);
      }
    }
  }
  return (
    <section
      className="space-y-4 rounded-xl border border-border bg-card p-5"
      aria-label="商城异常监控"
    >
      <h2 className="text-lg font-semibold">商城异常监控</h2>
      <p className="text-sm text-muted-foreground">
        后台每 5
        分钟观察一次，页面每分钟重新查询。仅提醒人工跟进，不会自动退款、重付、放款或修改账本；提现提醒不是合同逾期或银行到账认定。
      </p>
      <p className="text-sm text-amber-900">
        邮件状态只表示请求处理过程，不代表收件确认或业务已解决。正式通知方式尚未确定；未知结果需人工核查，不会自动重发，本页没有重发或资金操作。
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm">
          告警范围{" "}
          <select
            aria-label="告警范围"
            className="rounded border border-border bg-background p-2"
            value={filter}
            disabled={busy || disabled}
            onChange={(event) => void load(event.target.value as Filter, [null], 0)}
          >
            <option value="open">待处理</option>
            <option value="resolved">已恢复</option>
            <option value="all">全部记录</option>
          </select>
        </label>
        <button
          className={button}
          disabled={busy || disabled}
          onClick={() => void load(filter, cursors, page)}
        >
          刷新告警
        </button>
      </div>
      {busy ? <p role="status">正在查询监控或定位原处理记录…</p> : null}
      {error ? (
        <p role="alert" className="text-sm text-red-800">
          {error}
        </p>
      ) : null}
      {data ? (
        <>
          {data.externalDelivery && typeof data.externalDelivery === "object" ? (
            <section
              className="space-y-2 rounded-lg border border-border p-3"
              aria-label="邮件提醒投递状态"
            >
              <p className="text-sm">
                {data.externalDelivery.configuration === "disabled"
                  ? "邮件提醒已关闭"
                  : data.externalDelivery.configuration === "unavailable"
                    ? "邮件配置未就绪，不能认为通知已发送"
                    : data.externalDelivery.mode === "mock"
                      ? "模拟邮件提醒，不发送真实邮件"
                      : "邮件服务已配置，接受请求仍不代表收到邮件"}
              </p>
              <p className="text-xs">
                已记录状态：等待 {data.externalDelivery.counts.pending} · 提交中{" "}
                {data.externalDelivery.counts.submitting} · 服务商接受{" "}
                {data.externalDelivery.counts.accepted} · 模拟{" "}
                {data.externalDelivery.counts.simulated} · 待人工核查{" "}
                {data.externalDelivery.counts.needsReview} · 已跳过{" "}
                {data.externalDelivery.counts.skipped}
              </p>
              <p className="text-xs">
                最近尝试：{data.externalDelivery.lastAttemptAt ?? "尚无记录"}
                ；这些计数不表示邮件实际送达。
              </p>
            </section>
          ) : (
            <p role="alert">邮件投递状态尚未确认，不能据此认为已通知或无需跟进。</p>
          )}
          <p className="text-sm">
            自动监控：{data.enabled ? "已启用" : "未启用"} · {healthLabels[data.monitor.status]}
          </p>
          <p className="text-xs text-muted-foreground">
            最近成功扫描：{data.monitor.lastSuccessfulScanAt ?? "尚无记录"} · 服务端超过{" "}
            {data.monitor.staleAfterSeconds / 60} 分钟未成功扫描会标为过期。
          </p>
          <p className="text-sm">
            已记录待处理 {data.counts.open} 条 · 连续观察中 {data.counts.pending}{" "}
            条（未达到提醒窗口，不在通知列表）。
          </p>
          {!data.incidents.length ? (
            <p className="text-sm">
              当前范围没有已记录的提醒；请同时查看扫描状态，不能据此认定没有异常。
            </p>
          ) : null}
          <ul className="space-y-3">
            {data.incidents.map((incident) => (
              <li key={incident.id} className="space-y-2 rounded-lg border border-border p-4">
                <h3 className="font-medium">
                  {labels[incident.kind]} ·{" "}
                  {incident.state === "resolved" ? "该类异常已恢复" : "待处理"}
                </h3>
                <p className="break-all text-xs text-muted-foreground">
                  资源 {incident.resourceType} / {incident.resourceId} · 状态{" "}
                  {incident.sourceStatus}
                </p>
                <p className="text-xs">
                  首次观察 {incident.firstDetectedAt} · 开始提醒 {incident.openedAt}
                  {incident.resolvedAt ? ` · 恢复 ${incident.resolvedAt}` : ""}
                </p>
                {incident.state === "resolved" ? (
                  <p className="text-xs">
                    仅表示该类条件已消失，不代表此订单其他异常、售后或财务风险均已解决。
                  </p>
                ) : null}
                {incident.emailDelivery ? (
                  <p className="text-xs">
                    邮件：{deliveryLabels[incident.emailDelivery.state]} ·{" "}
                    {incident.emailDelivery.mode === "mock" ? "TEST 模拟" : "邮件服务请求"}
                    <br />
                    尝试时间 {incident.emailDelivery.attemptedAt ?? "尚无记录"} · 处理时间{" "}
                    {incident.emailDelivery.completedAt ?? "尚未确认"}
                    {incident.emailDelivery.reasonCode
                      ? ` · 原因代码 ${incident.emailDelivery.reasonCode}`
                      : ""}
                  </p>
                ) : (
                  <p className="text-xs">尚无该提醒的邮件投递记录。</p>
                )}
                {incident.emailDelivery?.state === "submitting" ? (
                  <p className="text-xs">
                    提示：若已认领超过2分钟仍未确认，请人工核查；停用或配置无效时不会自动改写该记录或重发。
                  </p>
                ) : null}
                {incident.orderId ? (
                  <button
                    className={button}
                    disabled={busy || disabled}
                    onClick={() => void locate(() => onOrder(incident.orderId!))}
                  >
                    定位订单 {incident.orderId}
                  </button>
                ) : incident.resourceType === "withdrawal" ? (
                  onWithdrawal ? (
                    <button
                      className={button}
                      disabled={busy || disabled}
                      onClick={() => void locate(() => onWithdrawal(incident.resourceId))}
                    >
                      定位提现 {incident.resourceId}
                    </button>
                  ) : (
                    <p className="text-sm">查看提现处理记录需要财务查阅权限。</p>
                  )
                ) : (
                  <p className="text-sm">
                    当前没有可确认的订单归属，请凭事件 ID 人工核查，不会猜测订单或自动重试金融操作。
                  </p>
                )}
              </li>
            ))}
          </ul>
          <div className="flex items-center gap-3">
            <button
              className={button}
              disabled={busy || disabled || page === 0}
              onClick={() => void load(filter, cursors, page - 1)}
            >
              上一页告警
            </button>
            <span className="text-sm">第 {page + 1} 页</span>
            <button
              className={button}
              disabled={busy || disabled || !data.nextCursor}
              onClick={() =>
                void load(filter, [...cursors.slice(0, page + 1), data.nextCursor], page + 1)
              }
            >
              下一页告警
            </button>
          </div>
        </>
      ) : null}
    </section>
  );
}
