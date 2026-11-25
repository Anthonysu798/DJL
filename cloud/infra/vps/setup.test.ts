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
  for (const name of [".env.example", "Caddyfile", "Caddyfile.sites"])
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
    const sites = readFileSync(resolve(directory, "Caddyfile.sites.host"), "utf8");
    expect(sites).toContain("*.slcor.site {");
    expect(sites).toContain("reverse_proxy 127.0.0.1:8790");
    expect(sites).toContain(`tls ${resolve(directory, ".secrets/sites-origin")}/cert.pem`);
    expect(readFileSync(resolve(directory, "Caddyfile.host"), "utf8")).not.toContain("slcor.site");
  });
});

describe("VPS edge proxy", () => {
  const caddyfile = readFileSync(new URL("Caddyfile", import.meta.url), "utf8");
  // The text between a `<prefix> {` line and its matching closing brace.
  const block = (source: string, prefix: string) => {
    const start = source.indexOf(`${prefix} {\n`);
    expect(start, prefix).toBeGreaterThanOrEqual(0);
    let depth = 0;
    for (let index = start + prefix.length; index < source.length; index += 1) {
      if (source[index] === "{") depth += 1;
      if (source[index] === "}" && (depth -= 1) === 0) return source.slice(start, index + 1);
    }
    throw new Error(`Unclosed block: ${prefix}`);
  };
  const api = block(caddyfile, "{$API_HOST}");
  const storage = block(caddyfile, "{$STORAGE_HOST}");

  it("caps relay JSON bodies at the relay's own limit without limiting WebSocket sessions", () => {
    expect(api).toContain(
      "@remote_json path /v1/pairing/code/resolve /v1/trusted/session/resolve /v1/push/session/* /v1/sessions/*/revoke",
    );
    const json = block(api, "handle @remote_json");
    expect(json).toMatch(/request_body \{\s+max_size 16KiB\s+\}/);
    expect(json).toContain("reverse_proxy {$REMOTE_RELAY_UPSTREAM}");
    // Over HTTP/2 a WebSocket's frames are the request body, so the session route has no cap.
    const sessions = block(api, "handle /relay/*");
    expect(sessions).toContain("reverse_proxy {$REMOTE_RELAY_UPSTREAM}");
    expect(sessions).not.toContain("request_body");
  });

  it("caps every other API request body", () => {
    const fallback = block(api, "    handle");
    expect(fallback).toMatch(/request_body \{\s+max_size 20MiB\s+\}/);
    expect(fallback).toContain("reverse_proxy {$API_UPSTREAM}");
  });

  it("forces HTTPS on the API and storage hosts and keeps stored objects inert", () => {
    const hsts = 'Strict-Transport-Security "max-age=31536000; includeSubDomains"';
    expect(api).toContain(hsts);
    const headers = block(storage, "    header");
    expect(headers).toContain(hsts);
    expect(headers).toContain("X-Content-Type-Options nosniff");
    expect(headers).toContain("Content-Security-Policy sandbox");
    // Applied after the upstream answers, so a stored object's own headers cannot replace them.
    expect(headers).toContain("defer");
    // Uploads are sized by their presigned URL, not by the proxy.
    expect(storage).not.toContain("request_body");
  });

  it("drops client-supplied visitor IP headers on API and user-site requests", () => {
    const apiProxy = block(block(api, "    handle"), "        reverse_proxy {$API_UPSTREAM}");
    const sites = block(
      readFileSync(new URL("Caddyfile.sites", import.meta.url), "utf8"),
      "*.{$SITES_DOMAIN}",
    );
    const sitesProxy = block(sites, "    reverse_proxy {$SITES_UPSTREAM}");
    for (const proxy of [apiProxy, sitesProxy]) {
      expect(proxy).toContain("header_up -Fly-Client-IP");
      expect(proxy).toContain("header_up X-Forwarded-For {remote_host}");
    }
    expect(apiProxy).toContain("header_up -CF-Connecting-IP");
    // Sites are proxied by Cloudflare, so only a request from outside its ranges loses the header.
    const cloudflare = sites.match(/@not_cloudflare not remote_ip ([^\n]+)/)?.[1]?.split(" ");
    expect(cloudflare).toContain("173.245.48.0/20");
    expect(cloudflare).toContain("2400:cb00::/32");
    expect(sites).toContain("request_header @not_cloudflare -CF-Connecting-IP");
  });
});
