/** Commerce is personal-user scoped, CAD-only, and separate from AI microcredits. */
export interface CommerceProduct {
  readonly sku: string;
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly category: string;
  readonly imageUrl: string;
  readonly priceCents: number;
  readonly stock: number;
  readonly commissionBps: number;
  readonly returnDays: number;
}
/** Account-owned product ids only; never uploaded photos or browsing history. */
export interface CommerceFavoritesResponse {
  readonly userId: string;
  readonly productIds: readonly string[];
}
export interface CommerceFavoriteResponse {
  readonly userId: string;
  readonly productId: string;
  readonly saved: boolean;
}
export interface CommerceSupplierMemberList {
  readonly supplier: { readonly id: string; readonly name: string; readonly active: boolean };
  readonly members: readonly { readonly userId: string }[];
  readonly page: number;
  readonly hasMore: boolean;
}
export interface CommerceWallet {
  readonly pendingCents: number;
  readonly availableCents: number;
  readonly frozenCents: number;
  readonly paidCents: number;
  readonly recoveryCents: number;
}
export interface CommerceLedgerEntry {
  readonly id: string;
  readonly eventKey: string;
  readonly line: number;
  readonly ownerId: string;
  readonly account: string;
  readonly amountCents: number;
  readonly currency: "CAD";
  readonly mode: "test";
  readonly resourceId: string;
  readonly createdAt: string;
}
export interface CommerceAddress {
  readonly name: string;
  readonly line1: string;
  readonly city: string;
  readonly province: string;
  readonly postalCode: string;
  readonly country: "CA";
}
export interface CommerceAddressSuggestion {
  readonly placeId: string;
  readonly label: string;
}
/** An editable autocomplete result, not a promise that an address is deliverable. */
export interface CommerceAddressLookupResult extends Omit<CommerceAddress, "name"> {
  readonly line2?: string;
}
export interface CommerceProfile {
  readonly withdrawalsPaused?: boolean;
  readonly referralCode: string;
  readonly referrerId: string | null;
  readonly firstPaidAt: string | null;
  readonly wallet: CommerceWallet;
  readonly suppliers: readonly { readonly id: string; readonly name: string }[];
}
/** Direct-attribution totals after posted refunds, not an available or paid wallet balance. */
export interface CommerceReferralSummary {
  readonly mode: "test";
  readonly currency: "CAD";
  readonly directBuyers: number;
  readonly ordersWithCommission: number;
  readonly netCommissionCents: number;
}
export interface CommerceReferralSummaryResponse {
  /** Authenticated viewer only, for client account-switch checking; never a referred buyer. */
  readonly userId: string;
  readonly referralSummary: CommerceReferralSummary;
}
/** Public factual receipt only, not a refund, delivery or financial outcome. */
export type CommerceBuyerAfterSalesStatus = "none" | "open" | "closed" | "unconfirmed";
export interface CommerceOrderItem {
  readonly sku: string | null;
  readonly id: string;
  readonly productId: string;
  readonly name: string;
  readonly quantity: number;
  readonly priceCents: number;
  readonly lineCents: number;
  readonly refundedCents: number;
  readonly status: "pending" | "accepted" | "shipped" | "delivered" | "cancelled";
  readonly carrier: string | null;
  readonly trackingNumber: string | null;
  readonly deliveredAt: string | null;
  readonly openCase: boolean;
  /** Optional for clients reading an older server; current order responses project it. */
  readonly afterSalesStatus?: CommerceBuyerAfterSalesStatus;
  readonly returnDays: number;
}
export interface CommerceOrder {
  readonly paymentProvider: "simulation" | "stripe_test";
  readonly id: string;
  readonly status: "awaiting_payment" | "paid" | "cancelled" | "refunded";
  readonly mode: "test";
  readonly currency: "CAD";
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly paidAt: string | null;
  readonly totalCents: number;
  readonly refundedCents: number;
  readonly address: CommerceAddress;
  readonly items: readonly CommerceOrderItem[];
}
export interface CommerceOrderRecoveryInput {
  readonly expectedUserId: string;
  readonly idempotencyKey: string;
}
export type CommerceOrderRecoveryResponse =
  | { readonly status: "found"; readonly order: CommerceOrder }
  | { readonly status: "closed" };
export type CommerceOrderAttentionReason =
  | "open_case"
  | "payment_unresolved"
  | "payment_review"
  | "refund_unresolved"
  | "external_refund_unresolved";
export interface CommerceSupplierIssue {
  readonly kind: "out_of_stock" | "delay" | "other";
  readonly reason: string;
  readonly reportedAt: string;
}
/** Versioned shape: older servers reject it rather than ignoring the idempotency key. */
export interface CommerceBuyerReturnRequestInput {
  readonly expectedUserId: string;
  readonly idempotencyKey: string;
  readonly request: {
    readonly itemId: string;
    readonly reason: string;
  };
}
export interface CommerceBuyerReturnRequest {
  readonly reason: string;
  readonly requestedAt: string;
}
export interface CommerceCaseHandling {
  readonly open: boolean;
  readonly reason: string | null;
  readonly handledBy: string;
  readonly handledAt: string;
}
/** Exact reviewed-close envelope; old servers reject it instead of closing unreviewed work. */
export interface CommerceReviewedCaseCloseInput {
  readonly reviewedClose: {
    readonly reason: string;
    readonly revision: string;
  };
}
export interface CommerceAdminOrder extends CommerceOrder {
  readonly attentionReasons: readonly CommerceOrderAttentionReason[];
  readonly items: readonly (CommerceOrderItem & {
    readonly supplierIssue?: CommerceSupplierIssue | null;
    readonly returnRequest?: CommerceBuyerReturnRequest | null;
    readonly caseHandling?: CommerceCaseHandling | null;
    /** Opaque staff review token. A client without it must not close a case. */
    readonly caseRevision?: string;
  })[];
}
export interface CommerceSupplierStatementRow {
  readonly eventKey: string;
  readonly resourceId: string;
  readonly ledgerEntryIds: readonly string[];
  readonly createdAt: string;
  readonly kind: "cost_accrual" | "refund_reversal" | "unclassified";
  readonly amountCents: number;
  readonly orderId: string | null;
  readonly orderItemId: string | null;
  readonly items: readonly {
    readonly itemId: string;
    readonly sku: string | null;
    readonly name: string;
    readonly quantity: number;
    readonly unitCostCents: number;
    readonly totalCostCents: number;
  }[];
}
export interface CommerceSupplierStatement {
  readonly supplier: { readonly id: string; readonly name: string; readonly active: boolean };
  readonly currency: "CAD";
  readonly mode: "test";
  readonly settlementAssessment: "not_assessed";
  readonly generatedAt: string;
  readonly period: { readonly from: string | null; readonly to: string };
  readonly summary: {
    readonly openingCents: number;
    readonly accruedCents: number;
    readonly reversedCents: number;
    readonly unclassifiedCents: number;
    readonly closingCents: number;
    readonly equationDifferenceCents: number;
    readonly reconciliationOk: boolean;
    readonly unclassifiedEntries: number;
    readonly hasUnresolvedRefunds: boolean;
  };
  readonly rows: readonly CommerceSupplierStatementRow[];
  readonly page: number;
  readonly pageSize: 100;
  readonly hasMore: boolean;
  readonly totalRows: number;
}
export interface CommerceSupplierPaymentDocumentInput {
  readonly operationId: string;
  readonly amountCents: number;
  readonly currency: "CAD";
  readonly reference: string;
  readonly evidenceReference: string;
  readonly reason: string;
}
export interface CommerceSupplierPaymentDocument extends CommerceSupplierPaymentDocumentInput {
  readonly id: string;
  readonly supplierId: string;
  readonly mode: "test";
  readonly source: "unverified_manual_test_document";
  readonly recordedBy: string;
  readonly recordedAt: string;
  readonly bankVerified: false;
  readonly settlementApplied: false;
  readonly referenceShared: boolean;
}
export interface CommerceSupplierPaymentDocumentMetadata {
  readonly mode: "test";
  readonly currency: "CAD";
  readonly supplierSettlement: "unsupported";
  readonly recordingEnabled: boolean;
  readonly disabledReason: string | null;
}
export interface CommerceSupplierPaymentDocumentsResponse extends CommerceSupplierPaymentDocumentMetadata {
  readonly records: readonly CommerceSupplierPaymentDocument[];
  readonly page: number;
  readonly pageSize: 100;
  readonly hasMore: boolean;
}
export interface CommerceSupplierPaymentDocumentResponse extends CommerceSupplierPaymentDocumentMetadata {
  readonly record: CommerceSupplierPaymentDocument;
}
export type CommerceAlertKind =
  | "payment_unresolved"
  | "payment_review"
  | "refund_unresolved"
  | "refund_review"
  | "refund_pending"
  | "event_unprocessed"
  | "event_review_unmapped"
  | "external_refund_unresolved"
  | "withdrawal_requested"
  | "withdrawal_approved";
export interface CommerceAlertIncident {
  readonly id: string;
  readonly kind: CommerceAlertKind;
  readonly resourceType:
    | "payment_attempt"
    | "provider_refund"
    | "payment_event"
    | "external_refund"
    | "withdrawal";
  readonly resourceId: string;
  readonly orderId: string | null;
  readonly sourceStatus: string;
  readonly state: "open" | "resolved";
  readonly firstDetectedAt: string;
  readonly openedAt: string;
  readonly lastSeenAt: string;
  readonly resolvedAt: string | null;
  readonly lastTransitionAt: string;
  readonly emailDelivery: CommerceAlertEmailDelivery | null;
}
export interface CommerceAlertEmailDelivery {
  readonly mode: "mock" | "resend";
  readonly state:
    | "pending"
    | "submitting"
    | "accepted"
    | "simulated"
    | "needs_review"
    | "skipped_resolved";
  readonly attemptedAt: string | null;
  readonly completedAt: string | null;
  readonly reasonCode: string | null;
}
export interface CommerceAlertEmailSummary {
  readonly enabled: boolean;
  readonly configuration: "disabled" | "unavailable" | "ready";
  readonly mode: "mock" | "resend";
  readonly counts: {
    readonly pending: number;
    readonly submitting: number;
    readonly accepted: number;
    readonly simulated: number;
    readonly needsReview: number;
    readonly skipped: number;
  };
  readonly lastAttemptAt: string | null;
}
export interface CommerceAlertsResponse {
  readonly enabled: boolean;
  readonly externalDelivery: CommerceAlertEmailSummary;
  readonly monitor: {
    readonly status: "disabled" | "never_scanned" | "stale" | "healthy";
    readonly lastSuccessfulScanAt: string | null;
    readonly intervalSeconds: 300;
    readonly staleAfterSeconds: 900;
  };
  readonly counts: { readonly open: number; readonly pending: number };
  readonly incidents: readonly CommerceAlertIncident[];
  readonly nextCursor: string | null;
}
export interface CommerceCatalogResponse {
  readonly paymentProvider?: "simulation" | "stripe_test" | "disabled";
  readonly checkoutPaused?: boolean;
  readonly products: readonly CommerceProduct[];
  readonly currency: "CAD";
  readonly mode: "test" | "disabled";
}
export interface CommerceOrdersResponse {
  readonly orders: readonly CommerceOrder[];
}
export interface CommerceWithdrawal {
  readonly id: string;
  readonly amountCents: number;
  readonly status:
    | "requested"
    | "approved"
    | "payment_pending"
    | "payment_unknown"
    | "paid_test"
    | "rejected";
  readonly reference: string | null;
  readonly paymentOperationId: string | null;
  readonly paymentStartedBy: string | null;
  readonly paymentStartedAt: string | null;
  readonly paymentUnknownAt: string | null;
  readonly createdAt: string;
}
export interface CommerceAdminWithdrawal extends CommerceWithdrawal {
  readonly userId: string;
  readonly approvedBy: string | null;
  readonly paymentConfirmedAt: string | null;
  readonly paymentConfirmedBy: string | null;
  readonly paymentEvidenceReference: string | null;
  readonly paymentConfirmationReason: string | null;
}
export interface CommerceConfirmWithdrawalPaymentInput {
  readonly operationId: string;
  readonly amountCents: number;
  readonly currency: "CAD";
  readonly reference: string;
  readonly evidenceReference: string;
  readonly reason: string;
}
export interface CommerceSupplierOrder extends CommerceOrderItem {
  readonly orderId: string;
  readonly address: CommerceAddress;
  readonly supplierIssue?: CommerceSupplierIssue | null;
}
export interface CommerceCreateOrderInput {
  readonly items: readonly { readonly productId: string; readonly quantity: number }[];
  readonly address: CommerceAddress;
  readonly idempotencyKey: string;
}
/** Private, buyer-owned upload for product search only; never an AI file. */
export interface CommerceImageUploadCompleteInput {
  readonly expectedUserId: string;
}
export interface CommerceImageUploadInput extends CommerceImageUploadCompleteInput {
  readonly mimeType: string;
  readonly size: number;
  readonly sha256: string;
}
export interface CommerceImageUploadReceipt {
  readonly userId: string;
  readonly id: string;
}
export interface CommerceImageUploadResponse extends CommerceImageUploadReceipt {
  readonly upload: {
    readonly url: string;
    readonly method: "PUT";
    readonly headers: Readonly<Record<string, string>>;
  };
}
export interface CommerceImageSearchResult {
  readonly products: readonly CommerceProduct[];
  readonly matchType: "similar";
  readonly modelId: string;
  readonly indexVersion: string;
  readonly message: string;
}
export interface CommerceProviderRefund {
  readonly id: string;
  readonly itemId: string;
  readonly amountCents: number;
  readonly refundTotalCents: number;
  readonly status:
    | "submitting"
    | "unknown"
    | "pending"
    | "succeeded"
    | "failed"
    | "requires_review";
  readonly createdAt: string;
}
export interface CommercePaymentStatus {
  readonly enabled: boolean;
  readonly mode: "test";
  readonly provider: "stripe_test";
  readonly paymentProvider: "stripe_test";
  readonly orderId: string;
  readonly attemptId: string | null;
  readonly sessionId: string | null;
  readonly status:
    | "not_started"
    | "creating"
    | "open"
    | "unknown"
    | "cancel_requested"
    | "paid"
    | "expired_unpaid"
    | "failed"
    | "requires_review";
  readonly checkoutUrl: string | null;
  readonly expiresAt: string | null;
  readonly refunds: readonly CommerceProviderRefund[];
}
export interface CommerceExternalRefund {
  readonly id: string;
  readonly orderId: string;
  readonly attemptId: string;
  readonly providerRefundId: string;
  readonly sourceEventId: string;
  readonly amountCents: number;
  readonly currency: "CAD";
  readonly providerStatus:
    | "unknown"
    | "pending"
    | "requires_action"
    | "succeeded"
    | "failed"
    | "canceled";
  readonly allocationState: "unallocated" | "allocated" | "excluded_owned" | "requires_review";
  readonly version: number;
  readonly allocatedAt: string | null;
  readonly allocations: readonly {
    readonly itemId: string;
    readonly amountCents: number;
    readonly refundedBeforeCents: number;
    readonly refundedAfterCents: number;
  }[];
}
export interface CommerceExternalRefundDetail {
  readonly refund: CommerceExternalRefund;
  readonly enabled: boolean;
  readonly canAllocate: boolean;
  readonly message: string;
  readonly items: readonly {
    readonly itemId: string;
    readonly name: string;
    readonly sku: string | null;
    readonly remainingCents: number;
  }[];
  readonly payment: CommercePaymentStatus;
}
export interface CommerceExternalRefundAllocationResult {
  readonly refund: CommerceExternalRefund;
  readonly payment: CommercePaymentStatus;
  readonly applied: boolean;
  readonly reviewCleared: boolean;
  readonly message: string;
}
