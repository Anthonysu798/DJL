import { describe, expect, it } from "vitest";
import { socialCredentialCipher } from "./credentials.ts";

describe("social credentials", () => {
  it("fails closed without a dedicated 256-bit hex key", () => {
    expect(socialCredentialCipher(undefined)).toBeNull();
    expect(socialCredentialCipher("password")).toBeNull();
  });
  it("encrypts non-deterministically and binds ciphertext to owner and account", () => {
    const cipher = socialCredentialCipher("ab".repeat(32))!;
    const token = { accessToken: "secret_access", refreshToken: "secret_refresh" };
    const a = cipher.encrypt(token, "user:org:account");
    expect(a).not.toContain("secret");
    expect(a).not.toBe(cipher.encrypt(token, "user:org:account"));
    expect(cipher.decrypt(a, "user:org:account")).toEqual(token);
    expect(() => cipher.decrypt(a, "other:org:account")).toThrow();
    expect(() => cipher.decrypt(a, "user:other:account")).toThrow();
    expect(() => cipher.decrypt(a, "user:org:other")).toThrow();
    expect(() => socialCredentialCipher("cd".repeat(32))!.decrypt(a, "user:org:account")).toThrow();
  });
});
