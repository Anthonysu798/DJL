"use client";

import { useEffect, useRef, useState } from "react";
import {
  COMMERCE_RECONCILIATION_CSV_HEADER,
  COMMERCE_RECONCILIATION_MAX_BYTES,
  COMMERCE_RECONCILIATION_MAX_ROWS,
  type CommerceReconciliationReport,
  type CommerceReconciliationResponse,
  type CommerceReconciliationRowStatus,
} from "@synara/contracts/cloud";
import { admin, AdminApiError, getToken } from "@/lib/api";

const button = "rounded-lg border border-border bg-card px-4 py-2 text-sm disabled:opacity-40";
const statusLabels: Record<CommerceReconciliationRowStatus, string> = {
  matched: "测试记录字段一致",
  manual_record_fields_match: "人工TEST资料字段一致（未结算）",
  not_found: "未找到记录",
  identifier_mismatch: "外部标识不一致",
  amount_mismatch: "金额不一致",
  duplicate: "文件内重复",
  ambiguous: "存在多个候选",
  unresolved: "结果尚未确认",
  inconsistent: "账本或业务记录不一致",
  unsupported: "不支持比对",
};
const amount = (cents: number | null) => {
  if (cents === null) return "未核实";
  const value = BigInt(cents);
  const absolute = value < 0n ? -value : value;
  return `CAD ${value < 0n ? "-" : ""}${absolute / 100n}.${(absolute % 100n).toString().padStart(2, "0")}`;
};
const errors: Record<string, string> = {
  commerce_reconciliation_csv_invalid: "CSV 格式无效，请核对列名、数据类型和最多 1000 行限制。",
  commerce_reconciliation_csv_too_large: `CSV 最多 ${COMMERCE_RECONCILIATION_MAX_BYTES} UTF-8 字节，请减少文件大小。`,
  commerce_reconciliation_disabled: "测试流水比对未启用；没有执行比对，也不能据此判断没有差异。",
  commerce_reconciliation_unavailable: "测试流水比对服务暂不可用，结果尚未确认。",
};

export function Reconciliation({ disabled = false }: { disabled?: boolean }) {
  const actor = getToken();
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<{
    actor: string | null;
    report: CommerceReconciliationReport;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const fileActor = useRef(actor);
  const controller = useRef<AbortController | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    fileActor.current = actor;
    generation.current++;
    controller.current?.abort();
    setFile(null);
    setResult(null);
    setError(null);
    setBusy(false);
    if (fileInput.current) fileInput.current.value = "";
    return () => {
      controller.current?.abort();
    };
  }, [actor]);

  const selectFile = (next: File | null) => {
    generation.current++;
    controller.current?.abort();
    setResult(null);
    setError(null);
    setBusy(false);
    setFile(null);
    if (next && next.size > COMMERCE_RECONCILIATION_MAX_BYTES) {
      setError(errors.commerce_reconciliation_csv_too_large!);
      return;
    }
    setFile(next);
  };
  const compare = async () => {
    if (!file || busy || disabled || !actor || fileActor.current !== actor) return;
    const request = ++generation.current;
    controller.current?.abort();
    const scope = new AbortController();
    controller.current = scope;
    const current = () =>
      generation.current === request && !scope.signal.aborted && getToken() === actor;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const csv = await file.text();
      if (!current()) return;
      if (new TextEncoder().encode(csv).byteLength > COMMERCE_RECONCILIATION_MAX_BYTES) {
        setError(errors.commerce_reconciliation_csv_too_large!);
        return;
      }
      const { report } = await admin<CommerceReconciliationResponse>(
        "/commerce/reconciliation/compare",
        {
          method: "POST",
          json: { csv },
          signal: scope.signal,
        },
      );
      if (!current()) return;
      if (
        report.mode !== "test" ||
        report.currency !== "CAD" ||
        report.source !== "unverified_manual_test_statement" ||
        report.fileCompleteness !== "not_assessed" ||
        report.bankBalance !== "not_assessed" ||
        report.supplierSettlement !== "unsupported" ||
        !Array.isArray(report.rows) ||
        report.rows.length > COMMERCE_RECONCILIATION_MAX_ROWS ||
        report.summary.rows !== report.rows.length ||
        report.summary.matched !== report.rows.filter((row) => row.status === "matched").length ||
        report.summary.exceptions !== report.rows.length - report.summary.matched ||
        report.rows.some(
          (row) =>
            !Array.isArray(row.ledgerEntryIds) ||
            (row.supplierPaymentDocumentId !== null &&
              (typeof row.supplierPaymentDocumentId !== "string" ||
                !row.supplierPaymentDocumentId.trim())) ||
            (row.type === "supplier_payout"
              ? row.ledgerEntryIds.length !== 0 ||
                row.status === "matched" ||
                (row.status === "manual_record_fields_match" &&
                  (!row.supplierPaymentDocumentId ||
                    row.expectedAmountCents === null ||
                    row.differenceCents !== 0))
              : row.supplierPaymentDocumentId !== null ||
                row.status === "manual_record_fields_match"),
        )
      )
        throw new Error("Unexpected test statement report");
      setResult({ actor, report });
    } catch (cause) {
      if (
        generation.current === request &&
        !scope.signal.aborted &&
        cause instanceof AdminApiError &&
        cause.status === 401 &&
        getToken() === null
      ) {
        setFile(null);
        setResult(null);
        setBusy(false);
        return;
      }
      if (!current()) return;
      setError(
        cause instanceof AdminApiError && errors[cause.code]
          ? errors[cause.code]!
          : "比对结果尚未确认，请核查登录权限或稍后重新读取；不能据此判断没有差异。",
      );
    } finally {
      if (current()) setBusy(false);
    }
  };
  const report = result?.actor === actor ? result.report : null;
  return (
    <section
      aria-label="测试流水只读比对"
      className="space-y-4 rounded-xl border border-border bg-card p-5"
    >
      <h2 className="text-lg font-semibold">TEST 流水只读比对</h2>
      <p className="text-sm text-amber-950">
        人工文件来源未核验，尚未确定正式收付款渠道；这里只比对测试记录字段，不是银行核验、到账证明或可打款批准。文件完整性、银行余额未评估；供应商应付不是已付款，供应商资料字段一致也不代表已结算。
      </p>
      <p className="text-sm text-muted-foreground">
        CSV
        与比对结果只保留在本页内存，不写入数据库、不保存文件；切换文件、账号或离开页面会清除。不发起付款、退款、提现或账本调整。
      </p>
      <details className="text-sm">
        <summary>CSV 格式与限制</summary>
        <p className="my-2 break-all">
          固定首行：<code>{COMMERCE_RECONCILIATION_CSV_HEADER}</code>
        </p>
        <p>
          最多 {COMMERCE_RECONCILIATION_MAX_ROWS} 数据行、{COMMERCE_RECONCILIATION_MAX_BYTES} UTF-8
          字节。amountCents 为正整数分，3900 表示 CAD 39.00；currency 仅 CAD；occurredAt 使用 UTC Z
          时间。
        </p>
        <ul className="list-inside list-disc">
          <li>payment：订单 ID + 精确 pi_* 付款标识。</li>
          <li>refund：订单 ID + 精确 re_* 退款标识；父退款总额只列一次，不重复列商品分配行。</li>
          <li>commission_payout：提现 ID + 精确打款参考号；只比对 paid_test 测试记录。</li>
          <li>
            supplier_payout：内部资料记录 ID + 参考文本；仅比对人工 TEST
            资料，不冲抵应付或核验银行。相同参考文本的多份资料仍需核查。
          </li>
        </ul>
      </details>
      <label className="block text-sm">
        选择测试流水 CSV
        <input
          ref={fileInput}
          type="file"
          accept=".csv,text/csv"
          disabled={disabled || !actor}
          onChange={(event) => selectFile(event.target.files?.[0] ?? null)}
          className="mt-2 block max-w-full"
        />
      </label>
      {file && fileActor.current === actor ? (
        <p className="break-all text-sm">当前文件：{file.name}</p>
      ) : null}
      {!actor ? <p role="status">请重新确认管理员登录后再选择文件。</p> : null}
      <button
        className={button}
        disabled={!file || busy || disabled || !actor || fileActor.current !== actor}
        onClick={() => void compare()}
      >
        开始只读比对
      </button>
      {busy && fileActor.current === actor ? (
        <p role="status">正在读取并比对测试记录，尚无已确认结果…</p>
      ) : null}
      {error && fileActor.current === actor ? (
        <p role="alert" className="text-sm text-red-800">
          {error}
        </p>
      ) : null}
      {report ? (
        <>
          <p className="text-sm">
            共 {report.summary.rows} 行 · 金融测试记录字段一致 {report.summary.matched} 行 · 待核查{" "}
            {report.summary.exceptions}{" "}
            行（含人工资料字段一致）；即使字段一致也不代表银行已收付或文件完整。
          </p>
          <p className="text-xs text-muted-foreground">
            测试比对时间：{report.generatedAt} · 差额“未核实”不是零差异。
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr>
                  <th>CSV 行</th>
                  <th>类型 / 业务 ID</th>
                  <th>结果</th>
                  <th>人工文件金额</th>
                  <th>内部记录金额 / 差额</th>
                  <th>账本流水 / 资料记录</th>
                </tr>
              </thead>
              <tbody>
                {report.rows.map((row) => (
                  <tr key={row.rowNumber} className="border-t border-border align-top">
                    <td className="p-2">{row.rowNumber}</td>
                    <td className="break-all p-2">
                      {row.type}
                      <br />
                      {row.businessId}
                    </td>
                    <td className="p-2">{statusLabels[row.status]}</td>
                    <td className="p-2">{amount(row.amountCents)}</td>
                    <td className="p-2">
                      {amount(row.expectedAmountCents)} / {amount(row.differenceCents)}
                    </td>
                    <td className="break-all p-2">
                      {row.supplierPaymentDocumentId ? (
                        <>资料记录 ID {row.supplierPaymentDocumentId}（不是账本分录）</>
                      ) : row.ledgerEntryIds.length ? (
                        row.ledgerEntryIds.join("、")
                      ) : (
                        "无已确认关联"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </section>
  );
}
