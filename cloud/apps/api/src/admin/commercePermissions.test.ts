import { describe, expect, it } from "vitest";
import { can, ROLE_PERMISSIONS } from "./AdminAuth.ts";
import { Schema } from "effect";
import { COMMERCE_STAFF_ROLES, COMMERCE_ADMIN_PERMISSIONS } from "@djl/domain";
import { schema } from "@djl/db";
import { CommerceStaffRole, CommerceAdminPermission } from "@synara/contracts/cloud";

const employee = {
  adminId: "staff",
  email: "synthetic@test.invalid",
  role: "employee" as const,
  sessionId: "session",
  mfaVerified: true,
};

describe("commerce-only staff permissions", () => {
  it("keeps database roles, public contracts and pure policy aligned", () => {
    expect(schema.commerceStaffRoleEnum.enumValues).toEqual([...COMMERCE_STAFF_ROLES]);
    for (const role of COMMERCE_STAFF_ROLES)
      expect(Schema.decodeUnknownSync(CommerceStaffRole)(role)).toBe(role);
    for (const permission of COMMERCE_ADMIN_PERMISSIONS)
      expect(Schema.decodeUnknownSync(CommerceAdminPermission)(permission)).toBe(permission);
    expect(() => Schema.decodeUnknownSync(CommerceStaffRole)("admin")).toThrow();
  });
  it.each(["operations", "support", "finance", "read_only", "none"] as const)(
    "does not grant AI/platform powers to %s, including revoked staff",
    (commerceRole) => {
      const staff = { ...employee, role: "commerce" as const, commerceRole };
      for (const permission of [
        ...ROLE_PERMISSIONS.employee,
        "admins.write",
        "catalog.write",
        "killswitch.write",
        "commerce.write",
        "commerce.unknown",
      ])
        expect(can(staff, permission)).toBe(false);
    },
  );
  it.each([
    ["operations", "commerce.catalog.write"],
    ["operations", "commerce.fulfillment.write"],
    ["support", "commerce.support.write"],
    ["finance", "commerce.finance.write"],
    ["read_only", "commerce.finance.read"],
  ] as const)("allows %s only its explicit %s capability", (commerceRole, permission) => {
    expect(can({ ...employee, role: "commerce", commerceRole }, permission)).toBe(true);
  });
  it("separates refund/payment, catalog and after-sales powers", () => {
    for (const commerceRole of ["operations", "support", "read_only", "none"] as const)
      expect(can({ ...employee, role: "commerce", commerceRole }, "commerce.finance.write")).toBe(
        false,
      );
    expect(
      can({ ...employee, role: "commerce", commerceRole: "finance" }, "commerce.catalog.write"),
    ).toBe(false);
    expect(
      can({ ...employee, role: "commerce", commerceRole: "operations" }, "commerce.support.write"),
    ).toBe(false);
    expect(
      can({ ...employee, role: "commerce", commerceRole: "support" }, "commerce.finance.read"),
    ).toBe(false);
  });
  it("does not fall back to a platform wildcard for a scoped or unknown commerce role", () => {
    expect(can({ ...employee, role: "commerce" }, "credits.grant")).toBe(false);
    expect(can({ ...employee, role: "admin", commerceRole: "finance" }, "credits.grant")).toBe(
      false,
    );
    const forged = { ...employee, role: "admin" as const, commerceRole: "forged" as never };
    expect(can(forged, "commerce.finance.write")).toBe(false);
    expect(can(forged, "users.read")).toBe(false);
  });
  it("preserves all legacy platform permissions when no commerce-only scope was assigned", () => {
    for (const permission of ROLE_PERMISSIONS.employee)
      expect(can(employee, permission)).toBe(true);
    expect(can(employee, "commerce.read")).toBe(false);
    expect(can({ ...employee, role: "admin" }, "commerce.finance.write")).toBe(true);
    expect(can({ ...employee, role: "admin" }, "credits.grant")).toBe(true);
  });
});
