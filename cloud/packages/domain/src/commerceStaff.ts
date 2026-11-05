export const COMMERCE_STAFF_ROLES = [
  "operations",
  "support",
  "finance",
  "read_only",
  "none",
] as const;
export type CommerceStaffRole = (typeof COMMERCE_STAFF_ROLES)[number];
export const COMMERCE_ADMIN_PERMISSIONS = [
  "commerce.read",
  "commerce.catalog.write",
  "commerce.fulfillment.write",
  "commerce.support.write",
  "commerce.finance.read",
  "commerce.finance.write",
  "commerce.monitor.read",
] as const;
export type CommerceAdminPermission = (typeof COMMERCE_ADMIN_PERMISSIONS)[number];

const permissions: Record<CommerceStaffRole, readonly CommerceAdminPermission[]> = {
  operations: [
    "commerce.read",
    "commerce.catalog.write",
    "commerce.fulfillment.write",
    "commerce.monitor.read",
  ],
  support: ["commerce.read", "commerce.support.write"],
  finance: [
    "commerce.read",
    "commerce.finance.read",
    "commerce.finance.write",
    "commerce.monitor.read",
  ],
  read_only: ["commerce.read", "commerce.finance.read", "commerce.monitor.read"],
  // Revocation must retain the commerce-only scope, never restore legacy AI support powers.
  none: [],
};
export function isCommerceStaffRole(value: unknown): value is CommerceStaffRole {
  return COMMERCE_STAFF_ROLES.some((role) => role === value);
}
export function commerceStaffCan(role: unknown, permission: string): boolean {
  return isCommerceStaffRole(role) && permissions[role].some((allowed) => allowed === permission);
}
