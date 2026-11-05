/**
 * Standalone test-only sidecar for the finance browser scenario. Run with Bun
 * --no-env-file --no-install against fresh, caller-owned loopback PG/Redis.
 * The caller consumes private ready.json, then writes stop (verify or cleanup).
 */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import type postgres from "postgres";
import type { isolatedCommerceTestDatabase } from "./isolatedDb.ts";
import type { startApi } from "../server.ts";

const apiOrigin = "http://localhost:48787";
const adminOrigin = "http://localhost:48731";
const buyerOrigin = "http://localhost:48789";
const reason = "Isolated TEST finance browser fixture; no actual funds or shipment";
const orderAmountCents = 50_000;
const withdrawalAmountCents = 5_000;
const refundAmountCents = 10_000;
const initialWallet = {
  pendingCents: 0,
  availableCents: 0,
  frozenCents: withdrawalAmountCents,
  paidCents: 0,
  recoveryCents: 0,
};
const finalWallet = { ...initialWallet, frozenCents: 0, paidCents: 5_000, recoveryCents: 1_000 };

function directory(value: string | undefined) {
  assert(
    value && path.isAbsolute(value) && statSync(value).isDirectory(),
    "Expected existing absolute fixture directory",
  );
  return realpathSync(value);
}

function normalizedDirectory(value: string) {
  if (process.platform !== "win32") return directory(value);
  // Native PostgreSQL reports a Windows path; Redis may be built with Cygwin.
  return directory(value.replace(/^\/cygdrive\/([a-z])\//i, "$1:/")).toLowerCase();
}

function localUrl(value: string | undefined, protocols: string[], database: string) {
  const url = new URL(value ?? "");
  assert(
    protocols.includes(url.protocol) &&
      ["localhost", "127.0.0.1"].includes(url.hostname) &&
      url.port &&
      url.password &&
      url.pathname === database &&
      !url.search &&
      !url.hash,
    "Expected explicit authenticated loopback service and base database",
  );
  url.hostname = "127.0.0.1";
  return url;
}

async function proveOwnedPostgres(pg: URL, pgData: string) {
  const { default: postgres } = await import("postgres");
  const base = postgres(pg.href, { max: 1, prepare: false, connect_timeout: 5 });
  try {
    const [actual] = await base<{ data: string; port: number; empty: boolean }[]>`
      select current_setting('data_directory') data, inet_server_port() port,
        not exists (select 1 from pg_database where datname not in ('postgres','template0','template1'))
        and not exists (
          select 1 from pg_stat_activity where backend_type='client backend' and pid<>pg_backend_pid()
        ) empty
    `;
    assert(
      actual &&
        actual.port === Number(pg.port) &&
        actual.empty &&
        normalizedDirectory(actual.data) === normalizedDirectory(pgData),
      "Expected owned fresh PostgreSQL",
    );
  } finally {
    await base.end({ timeout: 5 });
  }
}

async function proveOwnedRedis(redis: URL, redisData: string) {
  const { default: Redis } = await import("ioredis");
  const client = new Redis(redis.href, {
    lazyConnect: true,
    connectTimeout: 5_000,
    commandTimeout: 5_000,
    maxRetriesPerRequest: 0,
    retryStrategy: () => null,
  });
  client.on("error", () => {}); // Never log ambient DSNs or server error text.
  try {
    await client.connect();
    const configDir = await client.config("GET", "dir");
    const configPort = await client.config("GET", "port");
    const clients = await client.client("LIST");
    assert(
      Array.isArray(configDir) &&
        typeof configDir[1] === "string" &&
        normalizedDirectory(configDir[1]) === normalizedDirectory(redisData) &&
        Array.isArray(configPort) &&
        Number(configPort[1]) === Number(redis.port) &&
        typeof clients === "string" &&
        clients.trim().split("\n").length === 1 &&
        (await client.dbsize()) === 0 &&
        !(await client.info("keyspace")).includes("db"),
      "Expected owned fresh Redis",
    );
    await client.quit();
  } finally {
    client.disconnect();
  }
}

async function post<T>(route: string, body: object, token?: string) {
  const response = await fetch(apiOrigin + route, {
    method: "POST",
    headers: {
      origin: route.startsWith("/admin/") ? adminOrigin : buyerOrigin,
      "content-type": "application/json",
      ...(token ? { authorization: "Bearer " + token } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  assert.equal(response.status, 200, "Unexpected fixture HTTP status");
  return response.json() as Promise<T>;
}

type Connection = Awaited<ReturnType<typeof isolatedCommerceTestDatabase>>;
type Api = Awaited<ReturnType<typeof startApi>>;
type Staff = { id: string; email: string; password: string; totpSecret: string };
const credentials = ({ email, password, totpSecret }: Staff) => ({ email, password, totpSecret });
const ledgerRows = (sql: postgres.ISql) => sql`
  select id, event_key, owner_id, account, amount_cents, mode, currency, to_jsonb(l)::text row
  from commerce_ledger l order by event_key,line
`;
const creditRows = (sql: postgres.ISql) =>
  sql`select to_jsonb(c)::text row from credit_ledger c order by id`;
const hash = (rows: readonly unknown[]) =>
  createHash("sha256")
    .update(JSON.stringify([...rows]))
    .digest("hex");

async function verifyAccounting(
  connection: Connection,
  fixture: {
    withdrawalId: string;
    orderId: string;
    orderItemId: string;
    referrerId: string;
    deliveredAt: Date;
    financeA: Staff;
    financeB: Staff;
    readyAt: Date;
    beforeLedger: Awaited<ReturnType<typeof ledgerRows>>;
    beforeCredits: string;
  },
) {
  const {
    withdrawalId,
    orderId,
    orderItemId,
    referrerId,
    deliveredAt,
    financeA,
    financeB,
    readyAt,
  } = fixture;
  return connection.sql.begin("isolation level repeatable read read only", async (tx) => {
    // Compare typed timestamps in SQL; the shared Drizzle client parses them as strings.
    const [state] = await tx`
      select w.status='paid_test' and w.user_id=${referrerId}
        and w.amount_cents=${withdrawalAmountCents}
        and w.approved_by=${financeA.id} and w.payment_started_by=${financeB.id} and w.recorded_by=${financeB.id}
        and w.payment_operation_id is not null and w.reference is not null and w.payment_evidence_reference is not null
        and w.payment_started_at <= w.payment_unknown_at and w.payment_unknown_at <= w.payment_confirmed_at paid,
        o.mode='test' and o.payment_provider='simulation' and o.status='paid' and o.total_cents=${orderAmountCents}
        and o.refunded_cents=${refundAmountCents} and i.refunded_cents=${refundAmountCents}
        and i.status='delivered' and not i.open_case and i.delivered_at=${deliveredAt.toISOString()}::timestamptz
        and c.released and c.amount_cents=4000 and p.stock=10 and p.reserved=0 refunded,
        (select count(*)::int from commerce_withdrawals)=1 single_withdrawal,
        (select count(distinct a.id)::int from admins a join admin_sessions s on a.id=s.admin_id
          where a.id in (${financeA.id},${financeB.id}) and a.role='commerce' and a.commerce_role='finance'
            and s.created_at >= ${readyAt.toISOString()}::timestamptz and s.mfa_verified_at is not null) finance_mfa,
        not exists (select 1 from commerce_payment_attempts)
          and not exists (select 1 from commerce_provider_refunds)
          and not exists (select 1 from commerce_supplier_payment_documents) no_provider_records
      from commerce_withdrawals w cross join commerce_orders o
        join commerce_order_items i on i.order_id=o.id
        join commerce_commissions c on c.order_item_id=i.id
        join commerce_products p on p.id=i.product_id
      where w.id=${withdrawalId} and o.id=${orderId} and i.id=${orderItemId}
    `;
    assert(
      state?.paid &&
        state.refunded &&
        state.single_withdrawal &&
        state.finance_mfa === 2 &&
        state.no_provider_records,
      "Unexpected payout/refund/MFA SQL state",
    );

    const rows = await ledgerRows(tx);
    assert.equal(rows.length, 18, "Unexpected ledger length");
    const initialIds = new Set(fixture.beforeLedger.map((row) => row.id));
    assert.equal(
      hash(rows.filter((row) => initialIds.has(row.id))),
      hash(fixture.beforeLedger),
      "Original journal changed",
    );
    assert.equal(hash(await creditRows(tx)), fixture.beforeCredits, "AI credit ledger changed");
    const journals = new Map<string, number>();
    const accounts = new Map<string, number>();
    for (const row of rows) {
      const amount = Number(row.amount_cents);
      assert(row.mode === "test" && row.currency === "CAD" && Number.isSafeInteger(amount));
      journals.set(row.event_key, (journals.get(row.event_key) ?? 0) + amount);
      if (row.owner_id === referrerId)
        accounts.set(row.account, (accounts.get(row.account) ?? 0) + amount);
    }
    assert(
      journals.size === 5 &&
        [...journals.values()].every((total) => total === 0) &&
        journals.has("payout:" + withdrawalId) &&
        journals.has(`refund:${orderItemId}:${refundAmountCents}`),
      "Missing or unbalanced TEST journal",
    );
    const wallet = {
      pendingCents: accounts.get("pending") ?? 0,
      availableCents: accounts.get("available") ?? 0,
      frozenCents: accounts.get("frozen") ?? 0,
      paidCents: accounts.get("paid") ?? 0,
      recoveryCents: -(accounts.get("recovery") ?? 0),
    };
    assert.deepEqual(wallet, finalWallet);
    const audit = await tx`
      select action,actor_id from audit_events where
        (target_id=${withdrawalId} and action like 'commerce.withdrawal.%') or
        (target_id=${orderItemId} and action='commerce.item.refund')
    `;
    const expected = {
      "commerce.withdrawal.request": referrerId,
      "commerce.withdrawal.approve": financeA.id,
      "commerce.withdrawal.start_payment": financeB.id,
      "commerce.withdrawal.mark_unknown": financeB.id,
      "commerce.withdrawal.confirm_payment_success": financeB.id,
    };
    assert.equal(audit.length, 6);
    for (const [action, actor] of Object.entries(expected)) {
      assert.deepEqual(
        audit.filter((r) => r.action === action).map((r) => r.actor_id),
        [actor],
      );
    }
    const [refund, duplicate] = audit.filter((r) => r.action === "commerce.item.refund");
    assert(refund && !duplicate && [financeA.id, financeB.id].includes(refund.actor_id));
    return {
      wallet,
      balancedTestJournals: journals.size,
      ledgerRows: rows.length,
      auditedEvents: audit.length,
      freshFinanceMfaSessions: state.finance_mfa,
      priorJournalUnchanged: true,
      aiCreditsUnchanged: true,
      independentPaidTestRecorder: true,
      testRefundCents: refundAmountCents,
      noProviderRecords: true,
    };
  });
}

async function main() {
  assert.equal(
    process.env.DJL_FINANCE_E2E,
    "1",
    "Finance browser fixture requires explicit opt-in",
  );
  const dir = directory(process.env.DJL_FINANCE_E2E_DIR);
  const file = (name: string) => path.join(dir, name);
  for (const name of ["ready.json", "ready.json.tmp", "stop", "result.json", "result.json.tmp"]) {
    assert(!existsSync(file(name)), "Finance fixture directory must be fresh");
  }
  const receipt = (name: string, value: unknown) => {
    writeFileSync(file(name + ".tmp"), JSON.stringify(value), { flag: "wx", mode: 0o600 });
    renameSync(file(name + ".tmp"), file(name));
  };

  let api: Api | undefined;
  let connection: Connection | undefined;
  let accounting: Awaited<ReturnType<typeof verifyAccounting>> | undefined;
  let stage = "admit-services";
  let status: "verified" | "cleanup" | "failed" = "failed";
  let apiClosed = false;
  let databaseDropped = false;
  let blockedFetches = 0;
  const originalFetch = globalThis.fetch;
  const password = "Synthetic finance fixture passphrase " + randomUUID() + "!";
  try {
    assert(!process.env.DJL_ENV || ["local", "test"].includes(process.env.DJL_ENV));
    assert(process.env.COMMERCE_TEST_PGLITE !== "true", "Native PostgreSQL is required");
    const pg = localUrl(process.env.DATABASE_URL, ["postgres:", "postgresql:"], "/postgres");
    const redis = localUrl(process.env.REDIS_URL, ["redis:"], "/0");
    assert(pg.username, "Expected authenticated PostgreSQL");
    const pgData = directory(process.env.DJL_FINANCE_E2E_PG_DATA);
    const redisData = directory(process.env.DJL_FINANCE_E2E_REDIS_DIR);
    assert(pgData !== redisData && pg.port !== redis.port);
    // This entry owns its process; don't inherit service keys, proxy, observability or feature switches.
    for (const key of Object.keys(process.env)) {
      if (!/^(PATH|SYSTEMROOT|WINDIR|TEMP|TMP|TMPDIR|LANG|LC_ALL|LC_CTYPE)$/i.test(key))
        delete process.env[key];
    }
    Object.assign(process.env, {
      NODE_ENV: "test",
      DJL_ENV: "test",
      DJL_MOCK_EXTERNALS: "true",
      DJL_COMMERCE_MODE: "test",
      DJL_COMMERCE_PAYMENT_PROVIDER: "simulation",
      DATABASE_URL: pg.href,
      REDIS_URL: redis.href,
    });
    const breachPrefix = createHash("sha1")
      .update(password)
      .digest("hex")
      .slice(0, 5)
      .toUpperCase();
    globalThis.fetch = Object.assign(
      async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        if (
          url.origin === "https://api.pwnedpasswords.com" &&
          url.pathname === `/range/${breachPrefix}`
        ) {
          return new Response("00000000000000000000000000000000000:0\r\n");
        }
        if (url.origin !== apiOrigin) {
          blockedFetches++;
          throw new Error("Non-fixture fetch denied");
        }
        return originalFetch(input, { ...init, redirect: "error" });
      },
      {
        preconnect: () => {
          blockedFetches++;
          throw new Error("Fixture preconnect denied");
        },
      },
    );

    stage = "preflight-postgres";
    await proveOwnedPostgres(pg, pgData);
    stage = "preflight-redis";
    await proveOwnedRedis(redis, redisData);
    stage = "migrate-database";
    const { isolatedCommerceTestDatabase } = await import("./isolatedDb.ts");
    const { startApi } = await import("../server.ts");
    const { loadApiEnv } = await import("../config/env.ts");
    const { seed } = await import("../../../../packages/db/src/seed.ts");
    const { schema } = await import("@djl/db");
    const { TOTP, Secret } = await import("otpauth");
    connection = await isolatedCommerceTestDatabase();
    assert.match(connection.sql.options.database, /^djl_commerce_suite_[a-f0-9]{32}$/);
    pg.pathname = "/" + connection.sql.options.database;
    await seed(pg.href);
    stage = "start-test-api";
    api = await startApi({
      host: "127.0.0.1",
      port: Number(new URL(apiOrigin).port),
      env: loadApiEnv({
        DJL_ENV: "test",
        DJL_MOCK_EXTERNALS: "true",
        DATABASE_URL: pg.href,
        REDIS_URL: redis.href,
        API_PUBLIC_URL: apiOrigin,
        ADMIN_PUBLIC_URL: adminOrigin,
        WEB_PUBLIC_URL: buyerOrigin,
        ADMIN_MFA_REQUIRED: "true",
        SMS_ENABLED: "false",
        BETTER_AUTH_SECRET: randomUUID() + randomUUID(),
        IP_HASH_SALT: randomUUID(),
      }),
    });
    const outbox = api.outbox;
    assert(
      api.address.port === Number(new URL(apiOrigin).port) && outbox,
      "Synthetic outbox and fixed API port required",
    );

    stage = "provision-finance-mfa";
    const identity = (label: string) => ({
      email: `finance-${label}-${randomUUID()}@test.invalid`,
      password,
      name: "Synthetic " + label,
    });
    const owner = identity("owner");
    const { id: ownerId } = await api.adminAuth.create({ ...owner, role: "admin" });
    async function enroll(email: string) {
      const { token, admin } = await post<{ token: string; admin: { mfaVerified: boolean } }>(
        "/admin/v1/auth/login",
        { email, password },
      );
      assert.equal(admin.mfaVerified, false);
      const { secret } = await post<{ secret: string }>("/admin/v1/auth/totp/enroll", {}, token);
      const code = new TOTP({
        secret: Secret.fromBase32(secret),
        digits: 6,
        period: 30,
      }).generate();
      await post("/admin/v1/auth/totp/confirm", { code }, token);
      return { token, totpSecret: secret };
    }
    const { token: ownerToken } = await enroll(owner.email);
    async function financeStaff(label: string): Promise<Staff> {
      const { email, name } = identity(label);
      const staff = await post<{ id: string; role: string; commerceRole: string }>(
        "/admin/v1/admins",
        { email, name, role: "commerce", commerceRole: "finance", reason },
        ownerToken,
      );
      assert(staff.role === "commerce" && staff.commerceRole === "finance");
      const invite = outbox!.emails
        .findLast((m) => m.to === email && m.tag === "admin-invite")
        ?.text.match(/token=([A-Za-z0-9_-]+)/)?.[1];
      assert(invite, "Synthetic staff invitation missing");
      await post("/admin/v1/auth/invite/accept", { token: invite, password });
      const { totpSecret } = await enroll(email);
      return { id: staff.id, email, password, totpSecret };
    }
    const financeA = await financeStaff("reviewer");
    const financeB = await financeStaff("recorder");
    assert.notEqual(financeA.id, financeB.id);

    stage = "provision-verified-buyers";
    async function buyerAccount(label: string) {
      const account = identity(label);
      await post("/v1/auth/sign-up/email", account);
      const otp = outbox!.emails
        .findLast((m) => m.to === account.email && m.tag === "otp")
        ?.subject.match(/^(\d{6})/)?.[1];
      assert(otp, "Synthetic buyer verification missing");
      const { user } = await post<{ user: { id: string } }>("/v1/auth/email-otp/verify-email", {
        email: account.email,
        otp,
      });
      return { id: user.id, email: account.email, password };
    }
    const buyer = await buyerAccount("buyer");
    const referrer = await buyerAccount("referrer");
    const referrerId = referrer.id;
    assert.notEqual(buyer.id, referrerId);

    stage = "seed-historical-delivery";
    // Only historical snapshots + the original pending journal are seeded. The
    // real release/request methods must move commission through available → frozen.
    const orderId = randomUUID(),
      orderItemId = randomUUID(),
      productId = randomUUID(),
      supplierId = randomUUID();
    const sku = "SYNTH-FIN-" + randomUUID();
    const name = "Synthetic finance historical SKU";
    const now = Date.now();
    const daysAgo = (days: number) => new Date(now - days * 86_400_000);
    const createdAt = daysAgo(50),
      paidAt = new Date(createdAt.getTime() + 30_000),
      deliveredAt = daysAgo(45);
    const costCents = 20_000;
    const commissionBps = 1000;
    const referralCode = () => "FIN" + randomUUID().replaceAll("-", "").slice(0, 12);
    await connection.db.transaction(async (tx) => {
      await tx.insert(schema.commerceCustomers).values([
        { userId: referrerId, referralCode: referralCode(), createdAt: daysAgo(90) },
        {
          userId: buyer.id,
          referralCode: referralCode(),
          referrerId,
          firstPaidAt: paidAt,
          createdAt: daysAgo(90),
        },
      ]);
      await tx.insert(schema.commerceSuppliers).values({
        id: supplierId,
        name: "Synthetic supplier",
        returnAddress: "No dispatch address",
      });
      await tx.insert(schema.commerceProducts).values({
        id: productId,
        supplierId,
        sku,
        name,
        description: "Synthetic only",
        category: "QA",
        imageUrl: "/shop/media/synthetic-finance.png",
        priceCents: orderAmountCents,
        costCents,
        commissionBps,
        returnDays: 30,
        stock: 10,
        reserved: 0,
        status: "published",
      });
      await tx.insert(schema.commerceOrders).values({
        id: orderId,
        userId: buyer.id,
        referrerId,
        status: "paid",
        mode: "test",
        paymentProvider: "simulation",
        currency: "CAD",
        totalCents: orderAmountCents,
        refundedCents: 0,
        createdAt,
        paidAt,
        expiresAt: new Date(createdAt.getTime() + 30 * 60_000),
        address: {
          name: "Synthetic Receiver",
          line1: "123 Synthetic Test Street",
          city: "Toronto",
          province: "ON",
          postalCode: "M5V 2T6",
          country: "CA",
        },
      });
      await tx.insert(schema.commerceOrderItems).values({
        id: orderItemId,
        orderId,
        productId,
        supplierId,
        name,
        sku,
        quantity: 1,
        priceCents: orderAmountCents,
        costCents,
        lineCents: orderAmountCents,
        refundedCents: 0,
        commissionBps,
        returnDays: 30,
        status: "delivered",
        carrier: "Synthetic carrier",
        trackingNumber: "SYNTHETIC-NO-SHIPMENT",
        deliveredAt,
        openCase: false,
      });
      await tx.insert(schema.commerceCommissions).values({
        orderItemId,
        userId: referrerId,
        amountCents: withdrawalAmountCents,
        released: false,
        createdAt: paidAt,
      });
      const paid = [
        ["platform", "cash_test", orderAmountCents],
        ["platform", "sales_test", -orderAmountCents],
        [supplierId, "supplier_payable", costCents],
        ["platform", "goods_cost_test", -costCents],
        [referrerId, "pending", withdrawalAmountCents],
        ["platform", "commission_cost_test", -withdrawalAmountCents],
      ] as const;
      await tx.insert(schema.commerceLedger).values(
        paid.map(([ownerId, account, amountCents], line) => ({
          ownerId,
          account,
          amountCents,
          line,
          eventKey: "paid:" + orderId,
          resourceId: orderId,
          createdAt: paidAt,
        })),
      );
    });
    stage = "release-and-request";
    assert.deepEqual(
      await api.commerce.releaseCommissions(
        { type: "admin", id: ownerId, traceId: "finance-browser-fixture-release" },
        reason,
      ),
      { released: 1 },
    );
    const { withdrawal, wallet } = await api.commerce.requestWithdrawal(
      { type: "user", id: referrerId, traceId: "finance-browser-fixture-request" },
      randomUUID(),
    );
    assert.equal(withdrawal.status, "requested");
    assert.equal(withdrawal.amountCents, withdrawalAmountCents);
    assert.deepEqual(wallet, initialWallet);
    const withdrawalId = withdrawal.id;
    const beforeLedger = await ledgerRows(connection.sql);
    assert.equal(beforeLedger.length, 10);
    const beforeCredits = hash(await creditRows(connection.sql));
    const readyAt = new Date();
    receipt("ready.json", {
      apiOrigin,
      adminOrigin,
      pid: process.pid,
      withdrawalId,
      orderId,
      orderItemId,
      withdrawalAmountCents,
      refundAmountCents,
      initialWallet,
      finalWallet,
      financeA: credentials(financeA),
      financeB: credentials(financeB),
      referrer: { email: referrer.email, password: referrer.password },
    });

    stage = "wait-browser-stop";
    const deadline = Date.now() + 5 * 60_000;
    while (!existsSync(file("stop")) && Date.now() < deadline) await Bun.sleep(100);
    assert(existsSync(file("stop")), "Timed out waiting for browser stop");
    const stop = readFileSync(file("stop"), "utf8").trim();
    if (stop === "verify") {
      stage = "verify-accounting";
      accounting = await verifyAccounting(connection, {
        withdrawalId,
        orderId,
        orderItemId,
        referrerId,
        deliveredAt,
        financeA,
        financeB,
        beforeLedger,
        beforeCredits,
        readyAt,
      });
      assert.equal(blockedFetches, 0, "Unexpected outbound request");
      status = "verified";
    } else {
      assert.equal(stop, "cleanup", "Invalid fixture stop action");
      status = "cleanup";
    }
  } catch (error) {
    // Keep receipts actionable without auth/body/connection details.
    console.error(
      `Finance fixture failed: ${stage} (${error instanceof assert.AssertionError ? "assertion" : "runtime"})`,
    );
  } finally {
    try {
      if (api) {
        await api.close();
        apiClosed = true;
      }
    } catch {
      status = "failed";
      stage = "close-test-api";
    }
    try {
      if (connection) {
        await connection.close();
        databaseDropped = true;
      }
    } catch {
      status = "failed";
      stage = "drop-test-database";
    }
    globalThis.fetch = originalFetch;
    receipt("result.json", {
      status,
      apiClosed,
      databaseDropped,
      accounting,
      blockedFetches,
      stage,
    });
    if (status === "failed") process.exitCode = 1;
  }
}

if (import.meta.main) {
  await main().catch(() => {
    console.error("Finance fixture refused its invocation or could not write a private receipt");
    process.exitCode = 1;
  });
}
