"use client";

import { useEffect, useEffectEvent, useRef, useState, type FormEvent } from "react";
import type {
  CommerceSupplierPaymentDocument,
  CommerceSupplierPaymentDocumentInput,
  CommerceSupplierPaymentDocumentMetadata,
  CommerceSupplierPaymentDocumentResponse,
  CommerceSupplierPaymentDocumentsResponse,
} from "@synara/contracts/cloud";
import { admin, AdminApiError, getToken } from "@/lib/api";

type Supplier = { readonly id: string; readonly name: string };
interface Intent {
  supplier: Supplier;
  token: string;
  body: CommerceSupplierPaymentDocumentInput;
  recordId: string | null;
  confirmed: boolean;
  verifiedBy: string | null;
}
const button = "rounded-lg border border-border bg-card px-4 py-2 text-sm disabled:opacity-40";
const input = "mt-1 block w-full rounded border border-border bg-background p-2";
const money = (cents: number) => {
  const value = BigInt(cents);
  return `CAD ${value / 100n}.${(value % 100n).toString().padStart(2, "0")}`;
};
const path = (id: string) => `/commerce/suppliers/${encodeURIComponent(id)}/payment-records`;
function validMetadata(value: CommerceSupplierPaymentDocumentMetadata) {
  return (
    value?.mode === "test" &&
    value.currency === "CAD" &&
    value.supplierSettlement === "unsupported" &&
    typeof value.recordingEnabled === "boolean" &&
    (value.disabledReason === null || typeof value.disabledReason === "string")
  );
}
function validRecord(record: CommerceSupplierPaymentDocument, supplierId: string) {
  return (
    record?.supplierId === supplierId &&
    record.mode === "test" &&
    record.currency === "CAD" &&
    record.source === "unverified_manual_test_document" &&
    record.bankVerified === false &&
    record.settlementApplied === false &&
    typeof record.referenceShared === "boolean" &&
    Number.isSafeInteger(record.amountCents) &&
    record.amountCents > 0 &&
    [
      record.id,
      record.operationId,
      record.reference,
      record.evidenceReference,
      record.reason,
      record.recordedBy,
      record.recordedAt,
    ].every((value) => typeof value === "string" && value.trim())
  );
}
function matches(record: CommerceSupplierPaymentDocument, intent: Intent) {
  return (
    validRecord(record, intent.supplier.id) &&
    (!intent.recordId || intent.recordId === record.id) &&
    record.operationId === intent.body.operationId &&
    record.amountCents === intent.body.amountCents &&
    record.currency === intent.body.currency &&
    record.reference === intent.body.reference &&
    record.evidenceReference === intent.body.evidenceReference &&
    record.reason === intent.body.reason
  );
}

/** Documentation only. This component never computes payment eligibility or changes any ledger. */
export function SupplierPaymentRecords({
  supplier,
  disabled = false,
  canWrite = true,
}: {
  supplier: Supplier | null;
  disabled?: boolean;
  canWrite?: boolean;
}) {
  const actor = getToken();
  const intent = useRef<Intent | null>(null);
  const active = useRef(true);
  const working = useRef(false);
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const [, renderIntent] = useState(0);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [list, setList] = useState<{
    actor: string;
    supplierId: string;
    data: CommerceSupplierPaymentDocumentsResponse;
  } | null>(null);
  const [recordResult, setRecordResult] = useState<{
    actor: string;
    supplierId: string;
    record: CommerceSupplierPaymentDocument;
  } | null>(null);
  const [notice, setNotice] = useState<{
    actor: string | null;
    supplierId: string;
    text: string;
    error: boolean;
  } | null>(null);
  const scope = intent.current?.supplier ?? supplier;
  const context = useRef({ id: scope?.id, actor });
  context.current = { id: scope?.id, actor };
  useEffect(() => {
    const requestGeneration = generation;
    active.current = true;
    return () => {
      active.current = false;
      requestGeneration.current++;
      controller.current?.abort();
    };
  }, []);

  async function load(target: Supplier, page: number, token: string) {
    const request = ++generation.current;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    const current = () =>
      active.current &&
      !abort.signal.aborted &&
      generation.current === request &&
      getToken() === token &&
      context.current.id === target.id &&
      context.current.actor === token;
    setLoading(true);
    setNotice(null);
    try {
      const data = await admin<CommerceSupplierPaymentDocumentsResponse>(
        `${path(target.id)}${page ? `?page=${page}` : ""}`,
        { signal: abort.signal },
      );
      if (!current()) return;
      if (
        !validMetadata(data) ||
        data.page !== page ||
        data.pageSize !== 100 ||
        typeof data.hasMore !== "boolean" ||
        !Array.isArray(data.records) ||
        data.records.length > 100 ||
        !data.records.every((row) => validRecord(row, target.id))
      )
        throw Error("Unexpected TEST documents");
      setList({ actor: token, supplierId: target.id, data });
    } catch {
      if (current()) {
        setList(null);
        setNotice({
          actor: token,
          supplierId: target.id,
          text: "资料查询失败，不能据此判断没有历史记录。",
          error: true,
        });
      }
    } finally {
      if (current()) setLoading(false);
      else if (
        active.current &&
        generation.current === request &&
        !abort.signal.aborted &&
        getToken() !== token
      ) {
        setLoading(false);
        renderIntent((value) => value + 1);
      }
    }
  }
  const loadScope = useEffectEvent(() => {
    if (scope && actor) void load(scope, 0, actor);
  });
  useEffect(() => {
    const requestGeneration = generation;
    setList(null);
    setRecordResult(null);
    setNotice(null);
    setLoading(false);
    loadScope();
    return () => {
      requestGeneration.current++;
      controller.current?.abort();
    };
  }, [scope?.id, actor]);

  const view = list?.actor === actor && list.supplierId === scope?.id ? list.data : null;
  const shownRecord =
    recordResult?.actor === actor && recordResult.supplierId === scope?.id
      ? recordResult.record
      : null;
  const shownNotice = notice?.actor === actor && notice.supplierId === scope?.id ? notice : null;
  function notify(text: string, error = false) {
    if (scope) setNotice({ actor: getToken(), supplierId: scope.id, text, error });
  }
  async function verify(original: Intent) {
    if (working.current) return;
    const token = getToken();
    if (!token) return;
    working.current = true;
    setBusy(true);
    setNotice(null);
    const current = () => active.current && intent.current === original && getToken() === token;
    try {
      const result = await admin<CommerceSupplierPaymentDocumentResponse>(
        `${path(original.supplier.id)}/by-operation/${encodeURIComponent(original.body.operationId)}`,
      );
      if (!current()) return;
      if (!validMetadata(result) || !matches(result.record, original))
        throw Error("Document mismatch");
      original.recordId = result.record.id;
      original.confirmed = true;
      original.verifiedBy = token;
      setRecordResult({ actor: token, supplierId: original.supplier.id, record: result.record });
      setNotice({
        actor: token,
        supplierId: original.supplier.id,
        text: "资料已只读核对；仅为人工 TEST 资料，不代表银行收付或结算。",
        error: false,
      });
    } catch (cause) {
      if (current())
        setNotice({
          actor: token,
          supplierId: original.supplier.id,
          text:
            cause instanceof AdminApiError && cause.status === 404
              ? "暂未查到原资料，不代表银行付款失败。保留原操作编号，不要另建资料猜测结果。"
              : "原资料尚未核对，保留完整原请求；不能据此认定银行付款或结清。",
          error: true,
        });
    } finally {
      working.current = false;
      if (active.current) {
        setBusy(false);
        renderIntent((value) => value + 1);
      }
    }
  }
  const eligibility = useRef({ enabled: view?.recordingEnabled, disabled, loading, canWrite });
  eligibility.current = { enabled: view?.recordingEnabled, disabled, loading, canWrite };
  async function register(original: Intent, retry = false) {
    if (
      working.current ||
      disabled ||
      loading ||
      !canWrite ||
      !view?.recordingEnabled ||
      original.confirmed
    )
      return;
    if (getToken() !== original.token) {
      notify("登录身份已变化；原请求只能只读查证，不能由新身份重试。", true);
      return;
    }
    working.current = true;
    setBusy(true);
    setNotice(null);
    const current = () =>
      active.current &&
      intent.current === original &&
      getToken() === original.token &&
      context.current.id === original.supplier.id &&
      context.current.actor === original.token;
    try {
      if (retry) {
        try {
          const read = await admin<CommerceSupplierPaymentDocumentResponse>(
            `${path(original.supplier.id)}/by-operation/${encodeURIComponent(original.body.operationId)}`,
          );
          if (!current()) return;
          if (!validMetadata(read) || !matches(read.record, original))
            throw Error("Document mismatch");
          original.confirmed = true;
          original.recordId = read.record.id;
          original.verifiedBy = original.token;
          setRecordResult({
            actor: original.token,
            supplierId: original.supplier.id,
            record: read.record,
          });
          setNotice({
            actor: original.token,
            supplierId: original.supplier.id,
            text: "资料已只读核对；仅为人工 TEST 资料，不代表银行收付或结算。",
            error: false,
          });
          return;
        } catch (cause) {
          if (
            !(cause instanceof AdminApiError) ||
            cause.status !== 404 ||
            cause.code !== "not_found"
          )
            throw cause;
        }
        if (
          !current() ||
          original.confirmed ||
          !eligibility.current.canWrite ||
          !eligibility.current.enabled ||
          eligibility.current.disabled ||
          eligibility.current.loading
        )
          return;
      }
      const result = await admin<CommerceSupplierPaymentDocumentResponse>(
        path(original.supplier.id),
        { method: "POST", json: original.body },
      );
      if (!current()) return;
      if (!validMetadata(result) || !matches(result.record, original))
        throw Error("Document mismatch");
      original.confirmed = true;
      original.recordId = result.record.id;
      setRecordResult({
        actor: original.token,
        supplierId: original.supplier.id,
        record: result.record,
      });
      try {
        const read = await admin<CommerceSupplierPaymentDocumentResponse>(
          `${path(original.supplier.id)}/by-operation/${encodeURIComponent(original.body.operationId)}`,
        );
        if (!current()) return;
        if (!validMetadata(read) || !matches(read.record, original))
          throw Error("Document mismatch");
        original.verifiedBy = original.token;
        setRecordResult({
          actor: original.token,
          supplierId: original.supplier.id,
          record: read.record,
        });
        setNotice({
          actor: original.token,
          supplierId: original.supplier.id,
          text: "资料已只读核对；仅为人工 TEST 资料，不代表银行收付或结算。",
          error: false,
        });
      } catch {
        if (current())
          setNotice({
            actor: original.token,
            supplierId: original.supplier.id,
            text: "登记已确认，但只读核对失败；只能查询原资料，不会再次提交。",
            error: true,
          });
      }
    } catch {
      if (current())
        setNotice({
          actor: original.token,
          supplierId: original.supplier.id,
          text: "资料登记结果未知。请先只读查询原资料；如需重试，只能使用原完整请求。",
          error: true,
        });
    } finally {
      working.current = false;
      if (active.current) {
        setBusy(false);
        renderIntent((value) => value + 1);
      }
    }
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      !scope ||
      !actor ||
      intent.current ||
      busy ||
      working.current ||
      disabled ||
      loading ||
      !canWrite ||
      !view?.recordingEnabled
    )
      return;
    if (getToken() !== actor) {
      notify("登录身份已变化，请重新读取资料后再填写。", true);
      renderIntent((value) => value + 1);
      return;
    }
    const raw = new FormData(event.currentTarget);
    if (raw.get("acknowledge") !== "on") {
      notify("请确认这只是 TEST 资料登记，不转账、不结算或核验银行。", true);
      return;
    }
    const cents = String(raw.get("amountCents") ?? "").trim();
    const amountCents = Number(cents),
      reference = String(raw.get("reference") ?? "").trim();
    const evidenceReference = String(raw.get("evidenceReference") ?? "").trim(),
      reason = String(raw.get("reason") ?? "").trim();
    if (
      !/^[1-9]\d*$/.test(cents) ||
      !Number.isSafeInteger(amountCents) ||
      !reference ||
      reference.length > 150 ||
      !evidenceReference ||
      evidenceReference.length > 500 ||
      !reason ||
      reason.length > 500
    ) {
      notify(
        "请填写正整数加分金额、参考文本（1–150 字）及资料依据与原因（各 1–500 字），不能只填空白。",
        true,
      );
      return;
    }
    const original: Intent = {
      supplier: { ...scope },
      token: actor,
      body: {
        operationId: crypto.randomUUID(),
        amountCents,
        currency: "CAD",
        reference,
        evidenceReference,
        reason,
      },
      recordId: null,
      confirmed: false,
      verifiedBy: null,
    };
    intent.current = original;
    renderIntent((value) => value + 1);
    void register(original);
  }
  const original = intent.current;
  const records = shownRecord
    ? [shownRecord, ...(view?.records ?? []).filter((row) => row.id !== shownRecord.id)]
    : (view?.records ?? []);
  return (
    <section
      className="space-y-3 rounded-xl border border-border bg-background p-4"
      aria-label="供应商 TEST 人工付款资料"
    >
      <h3 className="font-semibold">人工 TEST 供应商付款资料（未结算）</h3>
      <p className="text-sm text-muted-foreground">
        不转账、不核验银行、不授权到期、不冲减采购应付，不计算最终未付或追回余额。参考文本可能来自分拆、其他来源或重复资料，不推定真实付款重复。
      </p>
      {!scope ? (
        <p className="text-sm">请先查询供应商应付对账单，以确定资料所属供应商。</p>
      ) : (
        <p className="text-sm">
          资料所属供应商：{scope.name} · {scope.id}
        </p>
      )}
      {!actor ? <p role="status">请先确认管理员登录；历史资料也需服务器授权读取。</p> : null}
      {!canWrite ? <p className="text-sm">当前账号只能查询 TEST 付款资料，不能新增记录。</p> : null}
      {original && supplier?.id !== original.supplier.id ? (
        <p role="status">查看范围已变化，请先核对原资料；不会把原请求换到其他供应商。</p>
      ) : null}
      {original ? (
        <div className="space-y-3 text-sm">
          <p>
            原操作编号 {original.body.operationId}
            。离开或刷新本页会丢失当前内存重试凭据，请先只读查证，不要直接另建操作。
          </p>
          {original.token === actor ? (
            <p className="break-all">
              原金额 {money(original.body.amountCents)} · 参考 {original.body.reference} · 依据{" "}
              {original.body.evidenceReference} · 原因 {original.body.reason}
            </p>
          ) : (
            <p role="alert">登录身份已变化；旧资料内容已隐藏，原请求不能由新身份重试。</p>
          )}
          <button
            className={button}
            disabled={busy || !actor}
            onClick={() => void verify(original)}
          >
            只读查询原资料
          </button>
          {original.confirmed ? (
            <p>服务器已确认登记；不会再次 POST。</p>
          ) : canWrite ? (
            <button
              className={button}
              disabled={
                busy || loading || disabled || !view?.recordingEnabled || original.token !== actor
              }
              onClick={() => void register(original, true)}
            >
              按原完整请求重试资料登记
            </button>
          ) : null}
          {canWrite && actor && original.verifiedBy === actor ? (
            <button
              className={button}
              disabled={busy}
              onClick={() => {
                if (
                  !eligibility.current.canWrite ||
                  working.current ||
                  intent.current?.verifiedBy !== getToken()
                )
                  return;
                intent.current = null;
                setRecordResult(null);
                setList(null);
                setNotice(null);
                renderIntent((value) => value + 1);
                if (supplier?.id === original.supplier.id) void load(supplier, 0, actor);
              }}
            >
              登记另一条资料
            </button>
          ) : null}
        </div>
      ) : canWrite && view?.recordingEnabled && actor ? (
        <form onSubmit={submit} className="grid gap-3 md:grid-cols-2">
          <label className="text-sm">
            金额（加分整数，1234 = CAD 12.34）
            <input
              className={input}
              name="amountCents"
              inputMode="numeric"
              required
              disabled={busy || loading || disabled}
            />
          </label>
          <label className="text-sm">
            TEST 参考文本
            <input
              className={input}
              name="reference"
              required
              maxLength={150}
              disabled={busy || loading || disabled}
            />
          </label>
          <label className="text-sm">
            TEST 资料依据编号
            <input
              className={input}
              name="evidenceReference"
              required
              maxLength={500}
              disabled={busy || loading || disabled}
            />
          </label>
          <label className="text-sm">
            登记原因
            <input
              className={input}
              name="reason"
              required
              maxLength={500}
              disabled={busy || loading || disabled}
            />
          </label>
          <label className="flex items-start gap-2 text-sm md:col-span-2">
            <input
              type="checkbox"
              name="acknowledge"
              required
              disabled={busy || loading || disabled}
            />
            我理解这只是未核验的人工 TEST 资料，不代表付款、银行核验或结算，不改变任何账本。
          </label>
          <button className={button} disabled={busy || loading || disabled}>
            登记 TEST 付款资料
          </button>
        </form>
      ) : null}
      {view && !view.recordingEnabled ? (
        <p role="status">
          登记未启用：{view.disabledReason ?? "当前不允许新增 TEST 资料"}；历史资料仍可读取。
        </p>
      ) : null}
      {scope && actor ? (
        <button
          className={button}
          disabled={busy || loading}
          onClick={() => void load(scope, view?.page ?? 0, actor)}
        >
          刷新资料记录
        </button>
      ) : null}
      {loading ? <p role="status">正在读取资料，尚不能认定记录为空…</p> : null}
      {shownNotice ? (
        <p role={shownNotice.error ? "alert" : "status"} className="text-sm">
          {shownNotice.text}
        </p>
      ) : null}
      {shownRecord ? (
        <p className="text-xs text-muted-foreground">
          先列当前原请求返回的资料，其余为查询页历史；均未作银行或结算核验。
        </p>
      ) : null}
      {records.map((record) => (
        <article className="space-y-1 rounded border border-border p-3 text-sm" key={record.id}>
          <p>
            资料记录 ID {record.id} · {money(record.amountCents)} · TEST / 未结算
          </p>
          <p className="break-all">
            参考 {record.reference} · 依据 {record.evidenceReference} · 原因 {record.reason}
          </p>
          <p>
            操作 {record.operationId} · 登记人 {record.recordedBy} · 登记时间 {record.recordedAt}
          </p>
          {record.referenceShared ? (
            <p className="text-amber-900">
              相同参考文本出现于多份资料，来源或分拆尚未核实，不能自动匹配成银行付款。
            </p>
          ) : null}
        </article>
      ))}
      {view && !loading && !records.length ? (
        <p className="text-sm">当前查询页暂无人工 TEST 资料；不代表没有付款或应付为零。</p>
      ) : null}
      {view && scope && actor ? (
        <div className="flex items-center gap-3">
          <button
            className={button}
            disabled={busy || loading || view.page === 0}
            onClick={() => void load(scope, view.page - 1, actor)}
          >
            上一页资料
          </button>
          <span className="text-sm">第 {view.page + 1} 页</span>
          <button
            className={button}
            disabled={busy || loading || !view.hasMore}
            onClick={() => void load(scope, view.page + 1, actor)}
          >
            下一页资料
          </button>
        </div>
      ) : null}
    </section>
  );
}
