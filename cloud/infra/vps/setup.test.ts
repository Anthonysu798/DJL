import {
  chmodSync,
  copyFileSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { initialize, prepare } from "./setup.ts";

const directories: string[] = [];
const fixture = () => {
  const directory = mkdtempSync(resolve(tmpdir(), "djl-vps-test-"));
  directories.push(directory);
  for (const name of [".env.example", "Caddyfile"])
    copyFileSync(new URL(name, import.meta.url), resolve(directory, name));
  initialize(directory);
  return directory;
};
afterEach(() => {
  for (const d of directories.splice(0)) rmSync(d, { recursive: true });
});

describe("VPS private configuration", () => {
  it("creates independent private credentials and refuses to overwrite them", () => {
    const directory = fixture();
    const env = parseEnv(readFileSync(resolve(directory, ".env"), "utf8"));
    expect(statSync(resolve(directory, ".env")).mode & 0o777).toBe(0o600);
    expect(env.POSTGRES_API_PASSWORD).not.toBe(env.POSTGRES_ADMIN_PASSWORD);
    expect(env.BETTER_AUTH_SECRET).not.toBe(env.IP_HASH_SALT);
    expect(() => initialize(directory)).toThrow("refusing to replace");
  });
  it("rejects exposed secrets, mocks, and missing real provider configuration", () => {
    const directory = fixture();
    const file = resolve(directory, ".env");
    chmodSync(file, 0o644);
    expect(() => prepare(directory)).toThrow("must be private");
    chmodSync(file, 0o600);
    expect(() => prepare(directory)).toThrow("TLS_EMAIL");
    writeFileSync(
      file,
      readFileSync(file, "utf8").replace("DJL_MOCK_EXTERNALS=false", "DJL_MOCK_EXTERNALS=true"),
    );
    expect(() => prepare(directory)).toThrow("cannot use mock");
  });
  it("creates private bucket-scoped S3 credentials and a host proxy fragment", () => {
    const directory = fixture();
    const env = prepare(directory, false);
    const file = resolve(directory, ".secrets/s3.json");
    const config = JSON.parse(readFileSync(file, "utf8"));
    expect(statSync(resolve(directory, ".secrets")).mode & 0o777).toBe(0o700);
    expect(statSync(file).mode & 0o777).toBe(0o644);
    expect(config.identities[0].actions).not.toContain("Admin");
    expect(config.identities[0].credentials[0].secretKey).toBe(env.STORAGE_SECRET_ACCESS_KEY);
    expect(readFileSync(resolve(directory, "Caddyfile.host"), "utf8")).toContain(
      "reverse_proxy 127.0.0.1:8787",
    );
  });
});
