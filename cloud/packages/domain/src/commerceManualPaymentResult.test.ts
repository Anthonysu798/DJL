import { describe, expect, it } from "vitest";
import * as commerce from "./commerce.ts";

const operationId = "00000000-0000-4000-8000-000000000001";
const confirmation = (
  status: commerce.CommerceWithdrawalStatus,
  existingOperationId = operationId,
) =>
  commerce.commerceWithdrawalPaymentTransition({
    status,
    action: "confirm_payment_success" as never,
    operationId,
    existingOperationId,
  });

describe("manual withdrawal payment success result", () => {
  it.each(["payment_pending", "payment_unknown"] as const)(
    "confirms the original %s operation without creating another payment",
    (status) => {
      expect(confirmation(status)).toEqual({ status: "paid_test", changed: true });
    },
  );

  it("replays the same confirmed operation without another transition", () => {
    expect(confirmation("paid_test")).toEqual({ status: "paid_test", changed: false });
  });

  it("cannot confirm a legacy paid record without an operation identity", () => {
    expect(() =>
      commerce.commerceWithdrawalPaymentTransition({
        status: "paid_test",
        action: "confirm_payment_success",
        operationId,
        existingOperationId: null,
      }),
    ).toThrow();
  });

  it.each(["requested", "approved", "rejected"] as const)(
    "cannot confirm %s without an existing payment operation",
    (status) => {
      expect(() => confirmation(status)).toThrow();
    },
  );

  it.each(["payment_pending", "payment_unknown", "paid_test"] as const)(
    "rejects another operation while %s",
    (status) => {
      expect(() => confirmation(status, "00000000-0000-4000-8000-000000000002")).toThrow();
    },
  );
});
