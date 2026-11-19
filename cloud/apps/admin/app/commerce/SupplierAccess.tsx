"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { CommerceSupplierMemberList } from "@synara/contracts/cloud";
import { admin, getAdminSessionRevision } from "@/lib/api";

const button = "rounded-lg border border-border bg-card px-4 py-2 text-sm disabled:opacity-40";
const input = "mt-1 block rounded border border-border bg-background p-2";
const errorMessage = (cause: unknown) =>
  cause instanceof TypeError
    ? "暂时无法连接商城管理服务，请稍后重试。"
    : cause instanceof Error
      ? cause.message
      : "请稍后重新查询。";

export function SupplierAccess({
  suppliers,
  disabled,
  onUpdated,
}: {
  suppliers: readonly { id: string; name: string; active: boolean }[];
  disabled: boolean;
  onUpdated: () => Promise<void>;
}) {
  const [selectedId, setSelectedId] = useState("");
  const [data, setData] = useState<CommerceSupplierMemberList | null>(null);
  const [loading, setLoading] = useState(false);
  const [mutating, setMutating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const selection = useRef({ id: "", version: 0 });
  const request = useRef(0);
  const unconfirmed = useRef(new Map<string, "unknown" | "acknowledged">());
  useEffect(
    () => () => {
      request.current++;
      selection.current.version++;
    },
    [],
  );

  async function load(id: string, page: number) {
    const token = ++request.current;
    const version = selection.current.version;
    const session = getAdminSessionRevision();
    const current = () =>
      session === getAdminSessionRevision() &&
      token === request.current &&
      id === selection.current.id &&
      version === selection.current.version;
    setLoading(true);
    setData(null);
    setError(null);
    setMessage(null);
    let membersRead = false;
    try {
      const result = await admin<CommerceSupplierMemberList>(
        `/commerce/suppliers/${encodeURIComponent(id)}/members?page=${page}`,
      );
      if (!current()) return false;
      membersRead = true;
      if (unconfirmed.current.has(id)) await onUpdated();
      if (!current()) return false;
      unconfirmed.current.delete(id);
      setData(result);
      return true;
    } catch (cause) {
      if (current())
        setError(
          `${membersRead ? "成员列表已读取，但关联页面刷新失败，请先刷新核对；不会重新提交变更。" : "成员列表尚未读取成功，不能据此判断没有成员。"}${errorMessage(cause)}`,
        );
      return false;
    } finally {
      if (current()) setLoading(false);
    }
  }
  function select(id: string) {
    if (disabled || mutating) return;
    selection.current = { id, version: selection.current.version + 1 };
    request.current++;
    setSelectedId(id);
    setData(null);
    setError(null);
    setMessage(null);
    if (id) void load(id, 0);
    else setLoading(false);
  }
  function mutate(event: FormEvent<HTMLFormElement>, memberId?: string) {
    event.preventDefault();
    if (disabled || loading || mutating || !data || unconfirmed.current.has(selectedId)) return;
    const reason = String(new FormData(event.currentTarget).get("reason") ?? "").trim();
    if (reason.length < 1 || reason.length > 500) {
      setError("原因须为去除首尾空白后的 1–500 个字符。");
      return;
    }
    const id = selectedId;
    const version = selection.current.version;
    const session = getAdminSessionRevision();
    const current = () =>
      session === getAdminSessionRevision() &&
      selection.current.id === id &&
      selection.current.version === version;
    const path = `/commerce/suppliers/${encodeURIComponent(id)}`;
    unconfirmed.current.set(id, "unknown");
    setMutating(true);
    setError(null);
    setMessage(null);
    void (async () => {
      try {
        await admin<{ ok: true }>(
          memberId ? `${path}/members/${encodeURIComponent(memberId)}/revoke` : `${path}/status`,
          {
            method: "POST",
            json: memberId ? { reason } : { active: !data.supplier.active, reason },
          },
        );
        if (!current()) return;
        unconfirmed.current.set(id, "acknowledged");
        if ((await load(id, 0)) && current())
          setMessage(
            "变更及最新成员状态已由服务器确认。历史及财务记录不删除，仍需跟进既有订单与售后。",
          );
      } catch (cause) {
        if (current()) {
          setData(null);
          setError(
            `操作结果尚未确认，请先刷新成员与状态核对；不会自动重试。${errorMessage(cause)}`,
          );
        }
      } finally {
        if (current()) setMutating(false);
      }
    })();
  }
  const blocked = disabled || loading || mutating;
  return (
    <section
      className="space-y-3 rounded-xl border border-border bg-card p-5"
      aria-label="供应商权限管理"
    >
      <h2 className="text-lg font-semibold">供应商权限与启停</h2>
      <p className="text-sm text-muted-foreground">
        停用会隐藏商品并阻止新订单和供应商操作；不会自动取消既有订单或退款，平台仍需跟进待履约与售后。历史及财务记录不删除。恢复供应商不会恢复已撤销的成员授权。
      </p>
      <label className="text-sm">
        管理供应商权限
        <select
          className={input}
          aria-label="管理供应商权限"
          value={selectedId}
          disabled={disabled || mutating}
          onChange={(event) => select(event.target.value)}
        >
          <option value="">请选择供应商</option>
          {suppliers.map((supplier) => (
            <option key={supplier.id} value={supplier.id}>
              {supplier.name} · {supplier.active ? "启用" : "停用"}
            </option>
          ))}
        </select>
      </label>
      {selectedId ? (
        <button
          className={button}
          disabled={blocked}
          onClick={() => void load(selectedId, data?.page ?? 0)}
        >
          刷新成员与状态
        </button>
      ) : (
        <p className="text-sm">请选择供应商，尚未读取成员权限。</p>
      )}
      {loading ? <p role="status">正在读取供应商成员与状态…</p> : null}
      {unconfirmed.current.has(selectedId) ? (
        <p role="status" className="text-sm text-amber-900">
          {unconfirmed.current.get(selectedId) === "acknowledged"
            ? "变更请求已由服务器确认，最新状态或关联页面尚未刷新；请先刷新核对，不要重复提交。"
            : "操作结果尚未确认，请先刷新成员与状态核对；不会自动重试。"}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-red-800">
          {error}
        </p>
      ) : null}
      {message ? (
        <p role="status" className="text-sm text-emerald-900">
          {message}
        </p>
      ) : null}
      {data ? (
        <>
          <p className="text-sm">
            已读取供应商：{data.supplier.name} · ID {data.supplier.id} ·{" "}
            {data.supplier.active ? "启用" : "停用"}
          </p>
          <h3 className="font-semibold">已授权成员 · 仅显示用户 ID</h3>
          {data.members.length ? (
            <ul className="space-y-3">
              {data.members.map((member) => (
                <li className="rounded-lg border border-border p-3" key={member.userId}>
                  <p className="break-all text-sm">{member.userId}</p>
                  <form
                    aria-label={`撤销成员 ${member.userId}`}
                    onSubmit={(event) => mutate(event, member.userId)}
                  >
                    <label className="text-sm">
                      撤销 {member.userId} 的原因
                      <textarea
                        className={input}
                        name="reason"
                        required
                        maxLength={500}
                        disabled={blocked}
                      />
                    </label>
                    <button className={button} disabled={blocked}>
                      撤销成员授权
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm">当前页没有已授权成员。</p>
          )}
          <div className="flex items-center gap-3">
            <button
              className={button}
              disabled={blocked || data.page === 0}
              onClick={() => void load(selectedId, data.page - 1)}
            >
              上一页成员
            </button>
            <span className="text-sm">第 {data.page + 1} 页</span>
            <button
              className={button}
              disabled={blocked || !data.hasMore}
              onClick={() => void load(selectedId, data.page + 1)}
            >
              下一页成员
            </button>
          </div>
          <form aria-label="供应商状态变更" onSubmit={(event) => mutate(event)}>
            <label className="text-sm">
              供应商状态变更原因
              <textarea
                className={input}
                name="reason"
                required
                maxLength={500}
                disabled={blocked}
              />
            </label>
            <button className={button} disabled={blocked}>
              {data.supplier.active ? "停用供应商" : "恢复供应商"}
            </button>
          </form>
        </>
      ) : null}
    </section>
  );
}
