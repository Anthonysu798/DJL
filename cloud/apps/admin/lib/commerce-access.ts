import type { CommerceAdminPermission, CommerceStaffRole } from "@synara/contracts/cloud";

export interface AdminIdentity {
  id: string;
  email: string;
  role: "admin" | "employee" | "commerce";
  mfaVerified: boolean;
  commerceRole?: CommerceStaffRole;
  commercePermissions?: readonly CommerceAdminPermission[];
}

export function adminHome(role: AdminIdentity["role"] | undefined): "/" | "/commerce" {
  return role === "commerce" ? "/commerce" : "/";
}

export function canCommerce(
  identity: AdminIdentity | null | undefined,
  permission: CommerceAdminPermission,
): boolean {
  if (identity?.mfaVerified !== true) return false;
  if (identity.role === "admin")
    return identity.commerceRole === undefined && identity.commercePermissions === undefined;
  if (identity.role !== "commerce") return false;
  switch (identity.commerceRole) {
    case "operations":
    case "support":
    case "finance":
    case "read_only":
      // Use the verified profile capabilities, not a second copy of the server role matrix.
      return (
        Array.isArray(identity.commercePermissions) &&
        identity.commercePermissions.includes(permission)
      );
    default:
      return false;
  }
}
