import { describe, expect, it } from "vitest";
import * as commerce from "./commerce.ts";

const operationId = "00000000-0000-4000-8000-000000000001";
const transition = (status: string, action: string, existingOperationId: string | null = null) =>
  commerce.commerceWithdrawalPaymentTransition({
    status: status as commerce.CommerceWithdrawalStatus,
    action: action as "start_payment" | "mark_unknown",
    operationId,
    existingOperationId,
  });

describe("manual withdrawal payment intent", () => {
  it("starts only an approved withdrawal and keeps an unknown result unresolved", () => {
    expect(transition("approved", "start_payment")).toEqual({
      status: "payment_pending",
      changed: true,
    });
    expect(transition("payment_pending", "mark_unknown", operationId)).toEqual({
      status: "payment_unknown",
      changed: true,
    });
  });

  it.each(["payment_pending", "payment_unknown"])(
    "retries the same %s operation without starting it again",
    (status) => {
      expect(transition(status, "start_payment", operationId)).toEqual({ status, changed: false });
    },
  );

  it("marks an unknown operation idempotently but never invents success or failure", () => {
    expect(transition("payment_unknown", "mark_unknown", operationId)).toEqual({
      status: "payment_unknown",
      changed: false,
    });
    expect(() => transition("approved", "mark_unknown")).toThrow();
    for (const status of ["requested", "paid_test", "rejected"]) {
      expect(() => transition(status, "start_payment")).toThrow();
      expect(() => transition(status, "mark_unknown", operationId)).toThrow();
    }
  });

  it.each(["payment_pending", "payment_unknown"])(
    "rejects another operation while %s",
    (status) => {
      expect(() => transition(status, "start_payment", "different-operation")).toThrow();
      expect(() => transition(status, "mark_unknown", "different-operation")).toThrow();
    },
  );
});
