import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";

const secretNames = [
  "POSTGRES_ADMIN_PASSWORD",
  "POSTGRES_MIGRATOR_PASSWORD",
  "POSTGRES_API_PASSWORD",
  "POSTGRES_WORKER_PASSWORD",
  "REDIS_PASSWORD",
  "STORAGE_ACCESS_KEY_ID",
  "STORAGE_SECRET_ACCESS_KEY",
  "BETTER_AUTH_SECRET",
  "IP_HASH_SALT",
] as const;

export function initialize(directory: string) {
  const target = resolve(directory, ".env");
  if (existsSync(target)) throw new Error(".env already exists; refusing to replace credentials.");
  let template = readFileSync(resolve(directory, ".env.example"), "utf8");
  for (const name of secretNames)
    template = template.replace(
      new RegExp(`^${name}=$`, "m"),
      `${name}=${randomBytes(32).toString("hex")}`,
    );
  writeFileSync(target, template, { mode: 0o600, flag: "wx" });
}

export function prepare(directory: string, checkProviders = true) {
  const target = resolve(directory, ".env");
  if (statSync(target).mode & 0o077) throw new Error(".env must be private: chmod 600 .env");
  const env = parseEnv(readFileSync(target, "utf8"));
  for (const name of secretNames)
    if (!/^[a-f0-9]{64}$/.test(env[name] ?? ""))
      throw new Error(`${name} must contain 64 random hex characters.`);
  if (!["staging", "production"].includes(env.DJL_ENV ?? ""))
    throw new Error("DJL_ENV must be staging or production.");
  if (env.DJL_MOCK_EXTERNALS !== "false")
    throw new Error("VPS deployments cannot use mock providers.");
  for (const provider of ["GOOGLE", "APPLE"])
    if (
      Boolean(env[`${provider}_OAUTH_CLIENT_ID`]) !==
      Boolean(env[`${provider}_OAUTH_CLIENT_SECRET`])
    )
      throw new Error(`${provider} OAuth needs both a client ID and client secret.`);
  for (const name of ["API_HOST", "WEB_HOST", "ADMIN_HOST", "STORAGE_HOST"])
    if (!/^(?!-)[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(env[name] ?? ""))
      throw new Error(`${name} must be a DNS hostname.`);
  if (checkProviders) {
    for (const name of [
      "TLS_EMAIL",
      "RESEND_API_KEY",
      "STRIPE_SECRET_KEY",
      "STRIPE_WEBHOOK_SECRET",
      "STRIPE_TOPUP_PRICE_ID",
    ])
      if (!env[name]?.trim()) throw new Error(`${name} is required before deployment.`);
    if (env.DJL_ENV === "staging" && !env.STRIPE_SECRET_KEY?.startsWith("sk_test_"))
      throw new Error("Staging requires a Stripe sandbox key.");
  }
  const secrets = resolve(directory, ".secrets");
  mkdirSync(secrets, { recursive: true, mode: 0o700 });
  chmodSync(secrets, 0o700);
  writeFileSync(
    resolve(secrets, "s3.json"),
    JSON.stringify({
      identities: [
        {
          name: "djl-files",
          credentials: [
            { accessKey: env.STORAGE_ACCESS_KEY_ID, secretKey: env.STORAGE_SECRET_ACCESS_KEY },
          ],
          actions: ["Read:djl-files", "Write:djl-files", "List:djl-files", "Tagging:djl-files"],
        },
      ],
    }),
    { mode: 0o644 },
  );
  // The host directory is private; the storage container drops to its own UID.
  chmodSync(resolve(secrets, "s3.json"), 0o644);
  const upstreams = {
    API_UPSTREAM: "127.0.0.1:8787",
    WEB_UPSTREAM: "127.0.0.1:3002",
    ADMIN_UPSTREAM: "127.0.0.1:3001",
    STORAGE_UPSTREAM: "127.0.0.1:8333",
  };
  const values = { ...env, ...upstreams };
  const caddy = readFileSync(resolve(directory, "Caddyfile"), "utf8").replace(
    /\{\$([A-Z_]+)\}/g,
    (_, name: string) => values[name] ?? "",
  );
  writeFileSync(resolve(directory, "Caddyfile.host"), caddy, { mode: 0o600 });
  return env;
}

if (import.meta.main) {
  try {
    if (process.argv[2] === "init") {
      initialize(process.cwd());
      console.log("Created private .env. Set domains and provider keys, then run djl.sh check.");
    } else {
      prepare(process.cwd());
      console.log("VPS configuration verified; private storage credentials prepared.");
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Invalid VPS configuration.");
    process.exit(1);
  }
}
