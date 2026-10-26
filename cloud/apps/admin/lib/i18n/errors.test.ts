import { describe, expect, it } from "vitest";
import { errorMessage } from "./errors";
import { AdminApiError } from "../api";

describe("localized errors and validation", () => {
  it("renders the same stored validation failure in another language", () => {
    expect(errorMessage("Password is required.", "zh-Hans")).toBe("密码为必填项。");
    expect(errorMessage("Password needs at least 14 characters.", "fr")).toBe(
      "Mot de passe doit contenir au moins 14 caractères.",
    );
    expect(errorMessage("Email is required.", "ja")).toBe("メールアドレスは必須です。");
  });
  it("localizes known API codes and hides unknown technical error messages", () => {
    expect(
      errorMessage(new AdminApiError(403, "forbidden", "Your role cannot write"), "zh-Hans"),
    ).toBe("您的角色没有执行此操作的权限。");
    expect(errorMessage(new AdminApiError(500, "unexpected", "SQL secret fixture"), "fr")).toBe(
      "Une erreur est survenue. Veuillez réessayer.",
    );
  });
  it("accepts structured API failures without depending on a particular Error constructor", () => {
    expect(
      errorMessage({ status: 403, code: "forbidden", message: "private detail" }, "zh-Hans"),
    ).toBe("您的角色没有执行此操作的权限。");
  });
  it("keeps entered values intact while localizing surrounding validation", () => {
    const message = errorMessage('"203.0.113.999" is not an IP address or IPv4 CIDR.', "zh-Hans");
    expect(message).toContain("203.0.113.999");
    expect(message).toContain("不是有效的IP地址或IPv4 CIDR");
  });
});
