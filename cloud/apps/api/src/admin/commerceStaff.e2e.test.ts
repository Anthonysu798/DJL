import { schema } from "@djl/db";
import { eq } from "drizzle-orm";
import * as OTPAuth from "otpauth";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { startApi, type ApiRuntime } from "../server.ts";
import { loadApiEnv } from "../config/env.ts";
import { isolatedCommerceTestDatabase } from "../testing/isolatedDb.ts";

let connection: Awaited<ReturnType<typeof isolatedCommerceTestDatabase>>;
let api: ApiRuntime;
let base = "",
  ownerToken = "",
  legacyToken = "";
const password = "Synthetic-strong-staff-password-42";
const roles = ["operations", "support", "finance", "read_only"] as const;
const staff = new Map<string, { id: string; email: string; token: string; secret: string }>();
const missing = "00000000-0000-4000-8000-000000000001";
async function call(
  path: string,
  token = ownerToken,
  json?: unknown,
  method?: string,
  extra: Record<string, string> = {},
) {
  const res = await fetch(base + "/admin/v1" + path, {
    method: method ?? (json === undefined ? "GET" : "POST"),
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: "Bearer " + token } : {}),
      ...extra,
    },
    body: json === undefined ? null : JSON.stringify(json),
  });
  return { status: res.status, body: (await res.json()) as any };
}
function code(secret: string) {
  return new OTPAuth.TOTP({
    secret: OTPAuth.Secret.fromBase32(secret),
    digits: 6,
    period: 30,
  }).generate();
}
async function enroll(email: string) {
  const login = await call("/auth/login", "", { email, password });
  expect(login.status).toBe(200);
  const token = login.body.token as string;
  expect((await call("/commerce/catalog", token)).body.error.code).toBe("mfa_required");
  const enrollment = await call("/auth/totp/enroll", token, {});
  expect(enrollment.status).toBe(200);
  const secret = enrollment.body.secret as string;
  expect((await call("/auth/totp/confirm", token, { code: code(secret) })).status).toBe(200);
  return { token, secret };
}

beforeAll(async () => {
  vi.stubEnv("DJL_COMMERCE_MODE", "test");
  vi.stubEnv("DJL_COMMERCE_PAYMENT_PROVIDER", "simulation");
  connection = await isolatedCommerceTestDatabase();
  const database = new URL(process.env.DATABASE_URL!);
  database.pathname = "/" + connection.sql.options.database;
  api = await startApi({
    host: "127.0.0.1",
    port: 0,
    env: loadApiEnv({
      ...process.env,
      DATABASE_URL: database.href,
      DJL_ENV: "test",
      DJL_MOCK_EXTERNALS: "true",
      ADMIN_MFA_REQUIRED: "true",
    }),
  });
  base = `http://127.0.0.1:${api.address.port}`;
  const ownerEmail = `scope-owner-${crypto.randomUUID()}@test.invalid`;
  await api.adminAuth.create({
    email: ownerEmail,
    name: "Synthetic owner",
    role: "admin",
    password,
  });
  ownerToken = (await enroll(ownerEmail)).token;
  const legacyEmail = `legacy-support-${crypto.randomUUID()}@test.invalid`;
  await api.adminAuth.create({
    email: legacyEmail,
    name: "Legacy support",
    role: "employee",
    password,
  });
  legacyToken = (await enroll(legacyEmail)).token;
  for (const commerceRole of roles) {
    const email = `shop-${commerceRole}-${crypto.randomUUID()}@test.invalid`;
    const invite = await call("/admins", ownerToken, {
      email,
      name: "Synthetic " + commerceRole,
      role: "employee",
      commerceRole,
      reason: "Explicit commerce-only assignment",
    });
    expect(invite.status).toBe(200);
    expect(invite.body.commerceRole).toBe(commerceRole);
    expect(invite.body.role).toBe("commerce");
    const message = api.outbox!.emails.findLast(
      (mail) => mail.to === email && mail.tag === "admin-invite",
    );
    const token = message?.text.match(/token=([A-Za-z0-9_-]+)/)?.[1];
    expect(typeof token).toBe("string");
    expect((await call("/auth/invite/accept", "", { token, password })).status).toBe(200);
    staff.set(commerceRole, { id: invite.body.id, email, ...(await enroll(email)) });
  }
});
afterAll(async () => {
  await api?.close();
  await connection?.close();
  vi.unstubAllEnvs();
});

it("exposes server-derived scope and allows each role only its explicit read capabilities", async () => {
  for (const role of roles) {
    const token = staff.get(role)!.token;
    const me = await call("/me", token);
    expect(me.body.admin.commerceRole).toBe(role);
    expect(me.body.admin.commercePermissions).toContain("commerce.read");
    expect((await call("/commerce/catalog", token)).status).toBe(200);
    expect((await call("/commerce/ledger", token)).status).toBe(
      role === "finance" || role === "read_only" ? 200 : 403,
    );
    expect((await call("/commerce/alerts", token)).status).toBe(role === "support" ? 403 : 200);
  }
});
it("denies AI/customer/platform administration and rejects spoofed role headers", async () => {
  for (const row of staff.values()) {
    for (const path of ["/users", "/settings", "/admins", "/models", "/kill-switches"])
      expect((await call(path, row.token)).status).toBe(403);
    expect(
      (
        await call(`/orgs/${missing}/credits/grant`, row.token, {
          credits: 1,
          reason: "Must never grant AI credits",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call("/admins", row.token, {
          email: "not-created@test.invalid",
          name: "Denied",
          role: "admin",
          reason: "Denied",
        })
      ).status,
    ).toBe(403);
  }
  expect(
    (
      await call("/commerce/ledger", staff.get("operations")!.token, undefined, undefined, {
        "x-commerce-role": "finance",
      })
    ).status,
  ).toBe(403);
  expect((await call("/users", legacyToken)).status).toBe(200);
  expect((await call("/commerce/catalog", legacyToken)).status).toBe(403);
  expect((await call("/users", ownerToken)).status).toBe(200);
});
it("allows operations and finance actions but rejects cross-role mutations before touching state", async () => {
  const operations = staff.get("operations")!.token;
  expect(
    (
      await call("/commerce/suppliers", operations, {
        name: "Synthetic vendor",
        returnAddress: "Synthetic Canadian return address",
        reason: "Operations role",
        idempotencyKey: crypto.randomUUID(),
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await call("/commerce/commissions/release", staff.get("finance")!.token, {
        reason: "Finance role; no eligible commissions",
      })
    ).status,
  ).toBe(200);
  for (const role of ["operations", "support", "read_only"] as const) {
    const token = staff.get(role)!.token;
    for (const path of [
      `/items/${missing}/refund`,
      `/withdrawals/${missing}/approve`,
      `/withdrawals/${missing}/start-payment`,
      `/withdrawals/${missing}/confirm-payment-success`,
      `/items/${missing}/provider-refunds`,
    ])
      expect((await call("/commerce" + path, token, { reason: "Denied" })).status).toBe(403);
  }
  expect((await call("/commerce/suppliers", staff.get("finance")!.token, {})).status).toBe(403);
  expect(
    (
      await call(`/commerce/items/${missing}/case`, staff.get("support")!.token, {
        open: true,
        reason: "Support role",
      })
    ).status,
  ).toBe(404);
  expect(
    (await call(`/commerce/items/${missing}/case`, operations, { open: true, reason: "Denied" }))
      .status,
  ).toBe(403);
});
it("rolls back a role change and session revocation together when audit insertion fails", async () => {
  const row = staff.get("finance")!;
  await connection.sql.unsafe(
    "CREATE FUNCTION reject_staff_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'admin.admin.update' THEN RAISE EXCEPTION 'Synthetic audit failure'; END IF; RETURN NEW; END $$",
  );
  await connection.sql.unsafe(
    "CREATE TRIGGER reject_staff_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_staff_audit()",
  );
  try {
    expect(
      (
        await call(
          `/admins/${row.id}`,
          ownerToken,
          { commerceRole: "none", reason: "Must roll back" },
          "PATCH",
        )
      ).status,
    ).toBe(500);
    const stored = await connection.db.query.admins.findFirst({
      where: eq(schema.admins.id, row.id),
    });
    expect(stored!.commerceRole).toBe("finance");
    expect((await call("/commerce/ledger", row.token)).status).toBe(200);
  } finally {
    await connection.sql.unsafe("DROP TRIGGER reject_staff_audit ON audit_events");
    await connection.sql.unsafe("DROP FUNCTION reject_staff_audit()");
  }
});
it("revokes sessions atomically and keeps the account commerce-only after fresh login", async () => {
  const row = staff.get("finance")!;
  expect(
    (
      await call(
        `/admins/${row.id}`,
        ownerToken,
        { commerceRole: "none", reason: "Revoke commerce access" },
        "PATCH",
      )
    ).status,
  ).toBe(200);
  expect((await call("/commerce/ledger", row.token)).status).toBe(401);
  const login = await call("/auth/login", "", {
    email: row.email,
    password,
    totp: code(row.secret),
  });
  expect(login.status).toBe(200);
  expect((await call("/me", login.body.token)).body.admin).toMatchObject({
    commerceRole: "none",
    commercePermissions: [],
  });
  expect((await call("/users", login.body.token)).status).toBe(403);
  expect((await call("/commerce/catalog", login.body.token)).status).toBe(403);
  expect(
    (
      await call(
        `/admins/${row.id}`,
        ownerToken,
        { commerceRole: null, reason: "No scope downgrade" },
        "PATCH",
      )
    ).status,
  ).toBe(400);
  expect(
    (
      await call(
        `/admins/${row.id}`,
        ownerToken,
        { role: "admin", reason: "No platform promotion" },
        "PATCH",
      )
    ).status,
  ).toBe(400);
  const audits =
    await connection.sql`select before, after, reason from audit_events where action='admin.admin.update' and target_id=${row.id}`;
  expect(audits).toHaveLength(1);
  expect(audits[0]).toMatchObject({
    before: { commerceRole: "finance" },
    after: { commerceRole: "none" },
    reason: "Revoke commerce access",
  });
});
it("enforces database scope constraints and rejects new invitations that request platform-admin scope", async () => {
  const scoped = staff.get("operations")!;
  await expect(
    connection.sql`update admins set role='employee' where id=${scoped.id}`,
  ).rejects.toMatchObject({ code: "23514" });
  await expect(
    connection.sql`insert into admins (email,name,role,commerce_role) values (${crypto.randomUUID() + "@test.invalid"},'Synthetic invalid','admin','finance')`,
  ).rejects.toMatchObject({ code: "23514" });
  expect(
    (
      await call("/admins", ownerToken, {
        email: "scope-invalid@test.invalid",
        name: "Invalid",
        role: "admin",
        commerceRole: "finance",
        reason: "Invalid mixed scope",
      })
    ).status,
  ).toBe(400);
  const [counts] =
    await connection.sql`select (select count(*)::int from credit_ledger) ai_ledger, (select count(*)::int from commerce_ledger) commerce_ledger`;
  expect(counts).toMatchObject({ ai_ledger: 0, commerce_ledger: 0 });
});

it("does not create an invitation, account or email when the role-assignment audit fails", async () => {
  const email = `audit-rollback-${crypto.randomUUID()}@test.invalid`;
  const messages = api.outbox!.emails.length;
  await connection.sql.unsafe(
    "CREATE FUNCTION reject_staff_invite() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'admin.admin.invite' THEN RAISE EXCEPTION 'Synthetic invite audit failure'; END IF; RETURN NEW; END $$",
  );
  await connection.sql.unsafe(
    "CREATE TRIGGER reject_staff_invite BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_staff_invite()",
  );
  try {
    expect(
      (
        await call("/admins", ownerToken, {
          email,
          name: "Synthetic audit rollback",
          role: "commerce",
          commerceRole: "read_only",
          reason: "Must roll back entire invitation",
        })
      ).status,
    ).toBe(500);
    expect(
      await connection.db.query.admins.findFirst({ where: eq(schema.admins.email, email) }),
    ).toBeUndefined();
    expect(api.outbox!.emails.length).toBe(messages);
  } finally {
    await connection.sql.unsafe("DROP TRIGGER reject_staff_invite ON audit_events");
    await connection.sql.unsafe("DROP FUNCTION reject_staff_invite()");
  }
});

it("keeps a failed token issuance inactive and supports an audited owner resend", async () => {
  const email = `token-rollback-${crypto.randomUUID()}@test.invalid`;
  const messages = api.outbox!.emails.length;
  await connection.sql.unsafe(
    "CREATE FUNCTION reject_staff_token() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'admin.invite.issued' THEN RAISE EXCEPTION 'Synthetic token audit failure'; END IF; RETURN NEW; END $$",
  );
  await connection.sql.unsafe(
    "CREATE TRIGGER reject_staff_token BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_staff_token()",
  );
  let id = "";
  try {
    expect(
      (
        await call("/admins", ownerToken, {
          email,
          name: "Synthetic token rollback",
          role: "commerce",
          commerceRole: "read_only",
          reason: "Token issue must roll back",
        })
      ).status,
    ).toBe(500);
    const row = await connection.db.query.admins.findFirst({
      where: eq(schema.admins.email, email),
    });
    expect(row).toMatchObject({ role: "commerce", commerceRole: "read_only", passwordHash: null });
    id = row!.id;
    const [tokens] =
      await connection.sql`select count(*)::int n from admin_invites where admin_id=${id}`;
    expect(tokens!.n).toBe(0);
    expect(api.outbox!.emails.length).toBe(messages);
  } finally {
    await connection.sql.unsafe("DROP TRIGGER reject_staff_token ON audit_events");
    await connection.sql.unsafe("DROP FUNCTION reject_staff_token()");
  }
  expect(
    (
      await call(`/admins/${id}/resend-invite`, ownerToken, {
        reason: "Retry only token/email delivery",
      })
    ).status,
  ).toBe(200);
  const [rows] = await connection.sql`select count(*)::int n from admins where email=${email}`;
  expect(rows!.n).toBe(1);
  expect(api.outbox!.emails.length).toBe(messages + 1);
});
