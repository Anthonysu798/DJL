/** Manual TEST transaction comparison, never bank verification or a settlement command. */
export const COMMERCE_RECONCILIATION_CSV_HEADER =
  "type,businessId,externalId,amountCents,currency,occurredAt";
export const COMMERCE_RECONCILIATION_MAX_BYTES = 200_000;
export const COMMERCE_RECONCILIATION_MAX_ROWS = 1_000;

export type CommerceReconciliationRowType =
  | "payment"
  | "refund"
  | "commission_payout"
  | "supplier_payout";

export type CommerceReconciliationRowStatus =
  | "matched"
  | "manual_record_fields_match"
  | "not_found"
  | "identifier_mismatch"
  | "amount_mismatch"
  | "duplicate"
  | "ambiguous"
  | "unresolved"
  | "inconsistent"
  | "unsupported";

export interface CommerceReconciliationRow {
  readonly rowNumber: number;
  readonly type: CommerceReconciliationRowType;
  readonly businessId: string;
  readonly amountCents: number;
  readonly status: CommerceReconciliationRowStatus;
  readonly expectedAmountCents: number | null;
  readonly differenceCents: number | null;
  /** Financial journal entries; empty for supplier manual documents. */
  readonly ledgerEntryIds: readonly string[];
  /** Internal supplier document ID only; never a transfer or ledger entry ID. */
  readonly supplierPaymentDocumentId: string | null;
}

export interface CommerceReconciliationReport {
  readonly mode: "test";
  readonly currency: "CAD";
  readonly source: "unverified_manual_test_statement";
  readonly fileCompleteness: "not_assessed";
  readonly bankBalance: "not_assessed";
  readonly supplierSettlement: "unsupported";
  readonly generatedAt: string;
  readonly summary: {
    readonly rows: number;
    /** Financial journal matches only, excluding manual document field agreement. */
    readonly matched: number;
    readonly exceptions: number;
  };
  readonly rows: readonly CommerceReconciliationRow[];
}

export interface CommerceReconciliationResponse {
  readonly report: CommerceReconciliationReport;
}
