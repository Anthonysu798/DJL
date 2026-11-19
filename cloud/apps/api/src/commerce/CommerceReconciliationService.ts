import { inArray, sql } from "drizzle-orm";
import { schema, type DjlDatabase } from "@djl/db";
import {
  COMMERCE_RECONCILIATION_CSV_HEADER,
  COMMERCE_RECONCILIATION_MAX_BYTES,
  COMMERCE_RECONCILIATION_MAX_ROWS,
  type CommerceReconciliationRow,
  type CommerceReconciliationReport,
  type CommerceReconciliationRowType,
  type CommerceReconciliationRowStatus,
} from "@synara/contracts/cloud";
import { ApiError } from "../http/errors.ts";

export interface CommerceReconciliationInputRow {
  readonly rowNumber: number;
  readonly type: CommerceReconciliationRowType;
  readonly businessId: string;
  readonly externalId: string;
  readonly amountCents: number;
  readonly occurredAt: string;
}

const invalid = (): never => {
  throw new ApiError(
    400,
    "commerce_reconciliation_csv_invalid",
    "Use the exact TEST CSV format with 1–1000 valid CAD rows.",
  );
};

/** A bounded, exact format: no spreadsheet evaluation, locale amounts, inferred time zone or fuzzy IDs. */
export function parseCommerceReconciliationCsv(input: unknown): CommerceReconciliationInputRow[] {
  if (typeof input !== "string") return invalid();
  if (Buffer.byteLength(input, "utf8") > COMMERCE_RECONCILIATION_MAX_BYTES)
    throw new ApiError(
      413,
      "commerce_reconciliation_csv_too_large",
      "TEST CSV exceeds 200000 UTF8 bytes.",
    );
  const source = input.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [],
    field = "",
    quoted = false,
    closed = false;
  const endField = () => {
    row.push(field);
    field = "";
    closed = false;
  };
  const endRow = () => {
    endField();
    rows.push(row);
    if (rows.length > COMMERCE_RECONCILIATION_MAX_ROWS + 1) invalid();
    row = [];
  };
  for (let i = 0; i < source.length; i++) {
    const c = source[i]!;
    if (quoted) {
      if (c === '"' && source[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
        closed = true;
      } else field += c;
    } else if (c === '"' && field === "" && !closed) quoted = true;
    else if (c === ",") endField();
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && source[i + 1] === "\n") i++;
      endRow();
    } else {
      if (closed || c === '"') return invalid();
      field += c;
    }
  }
  if (quoted) return invalid();
  if (field || row.length || closed) endRow();
  if (
    rows.length < 2 ||
    rows[0]!.length !== 6 ||
    rows[0]!.join(",") !== COMMERCE_RECONCILIATION_CSV_HEADER
  )
    return invalid();
  return rows.slice(1).map((cells, index) => {
    if (cells.length !== 6) return invalid();
    const [type, businessId, externalId, amount, currency, occurredAt] = cells as [
      string,
      string,
      string,
      string,
      string,
      string,
    ];
    if (
      !["payment", "refund", "commission_payout", "supplier_payout"].includes(type) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(businessId) ||
      currency !== "CAD" ||
      !/^[1-9][0-9]*$/.test(amount) ||
      !Number.isSafeInteger(Number(amount)) ||
      !externalId ||
      externalId !== externalId.trim() ||
      externalId.length > 150 ||
      [...externalId].some((c) => c.codePointAt(0)! < 32 || c.codePointAt(0) === 127) ||
      (type === "payment" && !/^pi_[A-Za-z0-9_]+$/.test(externalId)) ||
      (type === "refund" && !/^re_[A-Za-z0-9_]+$/.test(externalId)) ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(occurredAt) ||
      !Number.isFinite(Date.parse(occurredAt)) ||
      new Date(occurredAt).toISOString().slice(0, 19) !== occurredAt.slice(0, 19)
    )
      return invalid();
    return {
      rowNumber: index + 2,
      type: type as CommerceReconciliationRowType,
      businessId: businessId.toLowerCase(),
      externalId,
      amountCents: Number(amount),
      occurredAt,
    };
  });
}

export interface CommerceReconciliationOptions {
  readonly environment: "local" | "test" | "staging" | "production";
  readonly mode: "test" | "disabled";
}

export class CommerceReconciliationService {
  constructor(
    readonly db: DjlDatabase,
    readonly options: CommerceReconciliationOptions,
  ) {}

  async compare(csv: unknown): Promise<CommerceReconciliationReport> {
    if (this.options.mode !== "test" || !["local", "test"].includes(this.options.environment))
      throw new ApiError(
        503,
        "commerce_reconciliation_disabled",
        "Manual TEST comparison is disabled outside local/test commerce.",
      );
    const input = parseCommerceReconciliationCsv(csv);
    try {
      return await this.db.transaction(
        async (tx) => {
          const data = await snapshot(tx, input);
          const keys = new Map<string, number>();
          const rowKeys = input.map((r) =>
            r.type === "supplier_payout"
              ? [`${r.type}:business:${r.businessId}`]
              : [
                  `${r.type}:external:${r.externalId}`,
                  ...(["payment", "commission_payout"].includes(r.type)
                    ? [`${r.type}:business:${r.businessId}`]
                    : []),
                ],
          );
          for (const keysForRow of rowKeys)
            for (const key of keysForRow) keys.set(key, (keys.get(key) ?? 0) + 1);
          const rows = input.map((r, index) =>
            rowKeys[index]!.some((key) => keys.get(key)! > 1)
              ? result(
                  r,
                  "duplicate",
                  null,
                  [],
                  r.type === "supplier_payout"
                    ? (data.supplierDocuments.get(r.businessId)?.id ?? null)
                    : null,
                )
              : compareRow(r, data),
          );
          const matched = rows.filter((r) => r.status === "matched").length;
          return {
            mode: "test",
            currency: "CAD",
            source: "unverified_manual_test_statement",
            fileCompleteness: "not_assessed",
            bankBalance: "not_assessed",
            supplierSettlement: "unsupported",
            generatedAt: data.generatedAt,
            summary: { rows: rows.length, matched, exceptions: rows.length - matched },
            rows,
          };
        },
        { isolationLevel: "repeatable read", accessMode: "read only" },
      );
    } catch (error) {
      if (error instanceof ApiError) throw error;
      // Neither Drizzle bind values nor the uploaded statement reach logging/error responses.
      throw new ApiError(
        503,
        "commerce_reconciliation_unavailable",
        "TEST comparison could not be completed. No verified difference report is available.",
      );
    }
  }
}

type Tx = Parameters<Parameters<DjlDatabase["transaction"]>[0]>[0];
const {
  commercePaymentAttempts: attempts,
  commerceProviderRefunds: refunds,
  commerceExternalRefunds: external,
  commerceExternalRefundAllocations: allocations,
  commerceOrders: orders,
  commerceOrderItems: items,
  commerceWithdrawals: withdrawals,
  commerceSupplierPaymentDocuments: supplierDocuments,
  commerceLedger: ledger,
  commercePaymentEvents: events,
} = schema;
const unique = (values: readonly string[]) => [...new Set(values)];
function groupBy<T>(rows: readonly T[], key: (row: T) => string) {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    const group = groups.get(k) ?? [];
    group.push(row);
    groups.set(k, group);
  }
  return groups;
}

async function snapshot(tx: Tx, input: readonly CommerceReconciliationInputRow[]) {
  const [clock] = await tx.execute<{ at: string }>(sql`select transaction_timestamp()::text as at`);
  const paymentIds = unique(input.filter((r) => r.type === "payment").map((r) => r.externalId));
  const refundIds = unique(input.filter((r) => r.type === "refund").map((r) => r.externalId));
  const withdrawalIds = unique(
    input.filter((r) => r.type === "commission_payout").map((r) => r.businessId),
  );
  const supplierDocumentIds = unique(
    input.filter((r) => r.type === "supplier_payout").map((r) => r.businessId),
  );
  const supplierDocumentRows = supplierDocumentIds.length
    ? await tx
        .select({
          id: supplierDocuments.id,
          amountCents: supplierDocuments.amountCents,
          currency: supplierDocuments.currency,
          mode: supplierDocuments.mode,
          source: supplierDocuments.source,
          reference: supplierDocuments.reference,
        })
        .from(supplierDocuments)
        .where(inArray(supplierDocuments.id, supplierDocumentIds))
    : [];
  const supplierReferences = unique(supplierDocumentRows.map((row) => row.reference));
  const sharedSupplierReferences = supplierReferences.length
    ? await tx
        .select({ reference: supplierDocuments.reference })
        .from(supplierDocuments)
        .where(inArray(supplierDocuments.reference, supplierReferences))
        .groupBy(supplierDocuments.reference)
        .having(sql`count(*) > 1`)
    : [];
  const local = refundIds.length
    ? await tx
        .select({
          id: refunds.id,
          orderId: refunds.orderId,
          itemId: refunds.itemId,
          attemptId: refunds.attemptId,
          amountCents: refunds.amountCents,
          refundTotalCents: refunds.refundTotalCents,
          status: refunds.status,
          providerRefundId: refunds.providerRefundId,
          appliedAt: refunds.appliedAt,
        })
        .from(refunds)
        .where(inArray(refunds.providerRefundId, refundIds))
    : [];
  const outside = refundIds.length
    ? await tx
        .select({
          id: external.id,
          orderId: external.orderId,
          attemptId: external.attemptId,
          providerRefundId: external.providerRefundId,
          paymentIntentId: external.paymentIntentId,
          sourceEventId: external.sourceEventId,
          amountCents: external.amountCents,
          providerStatus: external.providerStatus,
          allocationState: external.allocationState,
        })
        .from(external)
        .where(inArray(external.providerRefundId, refundIds))
    : [];
  const selectedAttempts = paymentIds.length
    ? await tx
        .select({
          id: attempts.id,
          orderId: attempts.orderId,
          amountCents: attempts.amountCents,
          currency: attempts.currency,
          status: attempts.status,
          paymentIntentId: attempts.paymentIntentId,
        })
        .from(attempts)
        .where(inArray(attempts.paymentIntentId, paymentIds))
    : [];
  const orderIds = unique([
    ...input.filter((r) => r.type === "payment" || r.type === "refund").map((r) => r.businessId),
    ...local.map((r) => r.orderId),
    ...outside.map((r) => r.orderId),
    ...selectedAttempts.map((r) => r.orderId),
  ]);
  const relatedAttempts = orderIds.length
    ? await tx
        .select({
          id: attempts.id,
          orderId: attempts.orderId,
          amountCents: attempts.amountCents,
          currency: attempts.currency,
          status: attempts.status,
          paymentIntentId: attempts.paymentIntentId,
        })
        .from(attempts)
        .where(inArray(attempts.orderId, orderIds))
    : [];
  const orderRows = orderIds.length
    ? await tx
        .select({
          id: orders.id,
          totalCents: orders.totalCents,
          status: orders.status,
          paidAt: orders.paidAt,
          currency: orders.currency,
          mode: orders.mode,
          paymentProvider: orders.paymentProvider,
        })
        .from(orders)
        .where(inArray(orders.id, orderIds))
    : [];
  const withdrawalRows = withdrawalIds.length
    ? await tx
        .select({
          id: withdrawals.id,
          userId: withdrawals.userId,
          amountCents: withdrawals.amountCents,
          status: withdrawals.status,
          reference: withdrawals.reference,
        })
        .from(withdrawals)
        .where(inArray(withdrawals.id, withdrawalIds))
    : [];
  const parts = outside.length
    ? await tx
        .select()
        .from(allocations)
        .where(
          inArray(
            allocations.externalRefundId,
            outside.map((r) => r.id),
          ),
        )
    : [];
  const itemIds = unique([...local.map((r) => r.itemId), ...parts.map((r) => r.itemId)]);
  const itemRows = itemIds.length
    ? await tx
        .select({
          id: items.id,
          orderId: items.orderId,
          lineCents: items.lineCents,
          refundedCents: items.refundedCents,
        })
        .from(items)
        .where(inArray(items.id, itemIds))
    : [];
  const eventIds = unique(outside.map((r) => r.sourceEventId));
  const sourceEvents = eventIds.length
    ? await tx
        .select({
          id: events.id,
          type: events.type,
          objectId: events.objectId,
          processedAt: events.processedAt,
        })
        .from(events)
        .where(inArray(events.id, eventIds))
    : [];
  const unresolvedLocal = orderIds.length
    ? await tx
        .selectDistinct({ orderId: refunds.orderId })
        .from(refunds)
        .where(
          sql`${refunds.orderId} in (${sql.join(
            orderIds.map((id) => sql`${id}`),
            sql`,`,
          )}) and ${refunds.status} in ('submitting','unknown','pending','requires_review')`,
        )
    : [];
  const unresolvedExternal = orderIds.length
    ? await tx
        .selectDistinct({ orderId: external.orderId })
        .from(external)
        .where(
          sql`${external.orderId} in (${sql.join(
            orderIds.map((id) => sql`${id}`),
            sql`,`,
          )}) and (${external.allocationState} in ('unallocated','requires_review') or (${external.allocationState}='allocated' and ${external.providerStatus}<>'succeeded'))`,
        )
    : [];
  const eventKeys = unique([
    ...selectedAttempts.map((r) => `paid:${r.orderId}`),
    ...local.map((r) => `refund:${r.itemId}:${r.refundTotalCents}`),
    ...parts.map((r) => `refund:${r.itemId}:${r.refundedAfterCents}`),
    ...withdrawalRows.map((r) => `payout:${r.id}`),
  ]);
  if (eventKeys.length > 50_000) throw new Error("Comparison trace limit exceeded.");
  const entries = eventKeys.length
    ? await tx
        .select({
          id: ledger.id,
          eventKey: ledger.eventKey,
          resourceId: ledger.resourceId,
          ownerId: ledger.ownerId,
          account: ledger.account,
          amountCents: ledger.amountCents,
          currency: ledger.currency,
          mode: ledger.mode,
        })
        .from(ledger)
        .where(inArray(ledger.eventKey, eventKeys))
    : [];
  return {
    generatedAt: new Date(clock!.at).toISOString(),
    localById: groupBy(local, (r) => r.providerRefundId!),
    externalById: groupBy(outside, (r) => r.providerRefundId),
    attemptsByIntent: groupBy(selectedAttempts, (r) => r.paymentIntentId!),
    attempts: new Map(relatedAttempts.map((p) => [p.id, p])),
    partsByParent: groupBy(parts, (p) => p.externalRefundId),
    sourceEvents: new Map(sourceEvents.map((e) => [e.id, e])),
    orders: new Map(orderRows.map((r) => [r.id, r])),
    withdrawals: new Map(withdrawalRows.map((r) => [r.id, r])),
    supplierDocuments: new Map(supplierDocumentRows.map((r) => [r.id, r])),
    sharedSupplierReferences: new Set(sharedSupplierReferences.map((r) => r.reference)),
    items: new Map(itemRows.map((r) => [r.id, r])),
    entriesByEvent: groupBy(entries, (e) => e.eventKey),
    unresolved: new Set(
      [
        ...unresolvedLocal,
        ...unresolvedExternal,
        ...relatedAttempts.filter((p) =>
          ["creating", "open", "unknown", "cancel_requested", "requires_review"].includes(p.status),
        ),
      ].map((r) => r.orderId),
    ),
  };
}
type Snapshot = Awaited<ReturnType<typeof snapshot>>;

function result(
  row: CommerceReconciliationInputRow,
  status: CommerceReconciliationRowStatus,
  expected: number | null = null,
  entryIds: string[] = [],
  supplierPaymentDocumentId: string | null = null,
): CommerceReconciliationRow {
  return {
    rowNumber: row.rowNumber,
    type: row.type,
    businessId: row.businessId,
    amountCents: row.amountCents,
    status,
    expectedAmountCents: expected,
    differenceCents: expected === null ? null : row.amountCents - expected,
    ledgerEntryIds: entryIds,
    supplierPaymentDocumentId,
  };
}
function cashJournal(data: Snapshot, key: string, resource: string, amount: number) {
  const rows = data.entriesByEvent.get(key) ?? [];
  const cash = rows.filter((e) => e.account === "cash_test");
  return {
    ids: rows.map((e) => e.id).toSorted(),
    ok:
      rows.length > 1 &&
      rows.every(
        (e) =>
          e.resourceId === resource &&
          e.currency === "CAD" &&
          e.mode === "test" &&
          Number.isSafeInteger(e.amountCents),
      ) &&
      rows.reduce((sum, e) => sum + BigInt(e.amountCents), 0n) === 0n &&
      cash.length === 1 &&
      cash[0]!.ownerId === "platform" &&
      cash[0]!.amountCents === amount,
  };
}
function compareRow(
  row: CommerceReconciliationInputRow,
  data: Snapshot,
): CommerceReconciliationRow {
  if (row.type === "supplier_payout") {
    const document = data.supplierDocuments.get(row.businessId);
    if (!document) return result(row, "not_found");
    if (document.reference !== row.externalId)
      return result(row, "identifier_mismatch", null, [], document.id);
    if (
      document.source !== "unverified_manual_test_document" ||
      document.mode !== "test" ||
      document.currency !== "CAD" ||
      !Number.isSafeInteger(document.amountCents) ||
      document.amountCents <= 0
    )
      return result(row, "inconsistent", null, [], document.id);
    if (data.sharedSupplierReferences.has(document.reference))
      return result(row, "ambiguous", null, [], document.id);
    return result(
      row,
      row.amountCents === document.amountCents ? "manual_record_fields_match" : "amount_mismatch",
      document.amountCents,
      [],
      document.id,
    );
  }
  if (row.type === "commission_payout") {
    const w = data.withdrawals.get(row.businessId);
    if (!w) return result(row, "not_found");
    if (w.status !== "paid_test") return result(row, "unresolved");
    if (w.reference !== row.externalId) return result(row, "identifier_mismatch");
    const lines = data.entriesByEvent.get(`payout:${w.id}`) ?? [];
    if (
      lines.length !== 2 ||
      !lines.every(
        (e) =>
          e.resourceId === w.id &&
          e.ownerId === w.userId &&
          e.currency === "CAD" &&
          e.mode === "test",
      ) ||
      lines.find((e) => e.account === "frozen")?.amountCents !== -w.amountCents ||
      lines.find((e) => e.account === "paid")?.amountCents !== w.amountCents
    )
      return result(row, "inconsistent");
    return result(
      row,
      row.amountCents === w.amountCents ? "matched" : "amount_mismatch",
      w.amountCents,
      lines.map((e) => e.id).toSorted(),
    );
  }
  if (row.type === "payment") {
    const candidates = data.attemptsByIntent.get(row.externalId) ?? [];
    if (!candidates.length) return result(row, "not_found");
    if (candidates.length !== 1) return result(row, "ambiguous");
    const p = candidates[0]!;
    if (p.orderId !== row.businessId) return result(row, "identifier_mismatch");
    const order = data.orders.get(p.orderId);
    if (p.status !== "paid" || data.unresolved.has(p.orderId)) return result(row, "unresolved");
    if (
      !order ||
      !order.paidAt ||
      !["paid", "refunded"].includes(order.status) ||
      order.paymentProvider !== "stripe_test" ||
      order.mode !== "test" ||
      order.currency !== "CAD" ||
      p.currency !== "cad" ||
      p.amountCents !== order.totalCents
    )
      return result(row, "inconsistent");
    const journal = cashJournal(data, `paid:${order.id}`, order.id, p.amountCents);
    if (!journal.ok) return result(row, "inconsistent");
    return result(
      row,
      row.amountCents === p.amountCents ? "matched" : "amount_mismatch",
      p.amountCents,
      journal.ids,
    );
  }
  const owned = data.localById.get(row.externalId) ?? [];
  const outside = (data.externalById.get(row.externalId) ?? []).filter(
    (r) => !(r.allocationState === "excluded_owned" && owned.length),
  );
  if (!owned.length && !outside.length) return result(row, "not_found");
  if (owned.length + outside.length !== 1) return result(row, "ambiguous");
  const r = owned[0] ?? outside[0]!;
  if (r.orderId !== row.businessId) return result(row, "identifier_mismatch");
  if (data.unresolved.has(r.orderId)) return result(row, "unresolved");
  const order = data.orders.get(r.orderId);
  const attempt = data.attempts.get(r.attemptId);
  if (
    !order ||
    !order.paidAt ||
    !["paid", "refunded"].includes(order.status) ||
    order.paymentProvider !== "stripe_test" ||
    !attempt?.paymentIntentId ||
    attempt.status !== "paid"
  )
    return result(row, "unresolved");
  if (
    attempt.orderId !== r.orderId ||
    attempt.amountCents !== order.totalCents ||
    attempt.currency !== "cad" ||
    order.currency !== "CAD" ||
    order.mode !== "test"
  )
    return result(row, "inconsistent");
  const ids: string[] = [];
  if (owned[0]) {
    const local = owned[0];
    if (local.status !== "succeeded" || !local.appliedAt) return result(row, "unresolved");
    const item = data.items.get(local.itemId);
    const journal = cashJournal(
      data,
      `refund:${local.itemId}:${local.refundTotalCents}`,
      local.itemId,
      -local.amountCents,
    );
    if (
      !item ||
      item.orderId !== local.orderId ||
      item.refundedCents < local.refundTotalCents ||
      !journal.ok
    )
      return result(row, "inconsistent");
    ids.push(...journal.ids);
  } else {
    const e = outside[0]!;
    if (e.allocationState !== "allocated" || e.providerStatus !== "succeeded")
      return result(row, "unresolved");
    const source = data.sourceEvents.get(e.sourceEventId);
    const parts = data.partsByParent.get(e.id) ?? [];
    if (
      e.paymentIntentId !== attempt.paymentIntentId ||
      !source?.processedAt ||
      !["refund.created", "refund.updated", "refund.failed"].includes(source.type) ||
      source.objectId !== e.providerRefundId ||
      !parts.length ||
      parts.length > 50 ||
      parts.reduce((sum, p) => sum + BigInt(p.amountCents), 0n) !== BigInt(e.amountCents)
    )
      return result(row, "inconsistent");
    for (const part of parts) {
      const item = data.items.get(part.itemId);
      const journal = cashJournal(
        data,
        `refund:${part.itemId}:${part.refundedAfterCents}`,
        part.itemId,
        -part.amountCents,
      );
      if (
        !item ||
        item.orderId !== e.orderId ||
        item.refundedCents < part.refundedAfterCents ||
        part.refundedAfterCents - part.refundedBeforeCents !== part.amountCents ||
        !journal.ok
      )
        return result(row, "inconsistent");
      ids.push(...journal.ids);
    }
    if (new Set(ids).size !== ids.length) return result(row, "inconsistent");
  }
  return result(
    row,
    row.amountCents === r.amountCents ? "matched" : "amount_mismatch",
    r.amountCents,
    ids.toSorted(),
  );
}
