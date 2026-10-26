import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/** Separate key from session/auth keys; AAD prevents swapping credentials across owners. */
export function socialCredentialCipher(encodedKey: string | undefined) {
  if (!encodedKey || !/^[0-9a-f]{64}$/i.test(encodedKey)) return null;
  const key = Buffer.from(encodedKey, "hex");
  return {
    encrypt(value: unknown, owner: string): string {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      cipher.setAAD(Buffer.from(owner));
      const encrypted = Buffer.concat([
        cipher.update(JSON.stringify(value), "utf8"),
        cipher.final(),
      ]);
      return [
        "v1",
        iv.toString("base64url"),
        cipher.getAuthTag().toString("base64url"),
        encrypted.toString("base64url"),
      ].join(".");
    },
    decrypt<T>(value: string, owner: string): T {
      const [version, iv, tag, encrypted] = value.split(".");
      if (version !== "v1" || !iv || !tag || !encrypted)
        throw new Error("Invalid social credential envelope");
      const cipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
      cipher.setAAD(Buffer.from(owner));
      cipher.setAuthTag(Buffer.from(tag, "base64url"));
      return JSON.parse(
        Buffer.concat([
          cipher.update(Buffer.from(encrypted, "base64url")),
          cipher.final(),
        ]).toString("utf8"),
      ) as T;
    },
  };
}
