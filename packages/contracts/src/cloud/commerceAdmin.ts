import { Schema } from "effect";

export const CommerceStaffRole = Schema.Literals([
  "operations",
  "support",
  "finance",
  "read_only",
  "none",
]);
export type CommerceStaffRole = typeof CommerceStaffRole.Type;
export const CommerceAdminPermission = Schema.Literals([
  "commerce.read",
  "commerce.catalog.write",
  "commerce.fulfillment.write",
  "commerce.support.write",
  "commerce.finance.read",
  "commerce.finance.write",
  "commerce.monitor.read",
]);
export type CommerceAdminPermission = typeof CommerceAdminPermission.Type;
