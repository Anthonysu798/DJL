import { describe, expect, it } from "vitest";

import { hashPassword, verifyPassword } from "./password.ts";

describe("password hashing", () => {
  it("produces argon2id hashes that verify and reject wrong passwords", async () => {
    const hash = await hashPassword("correct-horse-battery-staple");
    expect(hash.startsWith("$argon2id$")).toBe(true);
    expect(await verifyPassword({ hash, password: "correct-horse-battery-staple" })).toBe(true);
    expect(await verifyPassword({ hash, password: "wrong" })).toBe(false);
    expect(await verifyPassword({ hash: "garbage", password: "x" })).toBe(false);
  });
});
