/**
 * Identity invariants over the real HTTP, Better Auth, Postgres and Redis
 * path: an unproven registration never outlives someone else's proof of the
 * mailbox, a deleted account stays deleted, an emailed code is not a way
 * around two-factor or a guessable secret, the personal-organization marker is
 * server-only, and a phone number has one spelling.
 */
import { and, eq } from "drizzle-orm";
import { schema } from "@djl/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { loadApiEnv } from "../config/env.ts";
import { startApi, type ApiRuntime } from "../server.ts";
import { TestClient } from "../testing/client.ts";
import { PERSONAL_ORG_METADATA } from "./auth.ts";

let api: ApiRuntime;
beforeAll(async () => {
  const env = loadApiEnv({
    ...process.env,
    DJL_ENV: "test",
    DJL_MOCK_EXTERNALS: "true",
    SMS_ENABLED: "true",
  });
  api = await startApi({ env, port: 0, host: "127.0.0.1" });
});
afterAll(async () => {
  await api.close();
});

const auth = "/v1/auth";
/** Every request from its own IP, so only the per-email limits can refuse it. */
const post = (path: string, json: object, client = TestClient.for(api)) =>
  client.call(auth + path, { method: "POST", json });
const freshEmail = (label: string) => `${label}-${crypto.randomUUID().slice(0, 8)}@test.invalid`;
const freshPassword = () => `QA-${crypto.randomUUID()}-only`;
const lastOtp = (email: string) =>
  api
    .outbox!.emails.findLast((m) => m.to === email && m.tag === "otp")!
    .subject.match(/^(\d{6})/)![1]!;
const wrongOtp = (otp: string) => (otp === "000000" ? "111111" : "000000");
const userByEmail = async (email: string) =>
  (await api.db.query.user.findFirst({ where: eq(schema.user.email, email) }))!;
const signIn = (email: string, password: string) => post("/sign-in/email", { email, password });

describe("pre-registered email", () => {
  it("belongs to whoever proves the mailbox, with only the password they chose", async () => {
    const email = freshEmail("prereg");
    const attackerPassword = freshPassword();
    const victimPassword = freshPassword();
    const first = await post("/sign-up/email", {
      email,
      password: attackerPassword,
      name: "Attacker",
    });
    expect(first.status).toBe(200);

    // The attacker's registration also holds a session and a linked identity.
    const stale = await userByEmail(email);
    const staleToken = crypto.randomUUID();
    await api.db.insert(schema.session).values({
      userId: stale.id,
      token: staleToken,
      expiresAt: new Date(Date.now() + 86_400_000),
      updatedAt: new Date(),
    });
    await api.db.insert(schema.account).values({
      userId: stale.id,
      providerId: "google",
      accountId: `attacker-${stale.id}`,
      updatedAt: new Date(),
    });

    const second = await post("/sign-up/email", {
      email,
      password: victimPassword,
      name: "Victim",
    });
    expect(second.status).toBe(200);
    // The same generic answer a first registration gets: nothing says the email was known.
    const firstBody = (await first.json()) as { token: unknown; user: Record<string, unknown> };
    const secondBody = (await second.json()) as { token: unknown; user: Record<string, unknown> };
    expect(secondBody.token).toBeNull();
    expect(Object.keys(secondBody).toSorted()).toEqual(Object.keys(firstBody).toSorted());
    expect(Object.keys(secondBody.user).toSorted()).toEqual(Object.keys(firstBody.user).toSorted());
    expect(secondBody.user).toMatchObject({ email, emailVerified: false, name: "Victim" });

    const victim = TestClient.for(api);
    const verified = await post("/email-otp/verify-email", { email, otp: lastOtp(email) }, victim);
    expect(verified.status).toBe(200);
    expect((await victim.call("/v1/me")).status).toBe(200);

    expect((await signIn(email, attackerPassword)).status).toBe(401);
    expect((await signIn(email, victimPassword)).status).toBe(200);
    expect((await TestClient.for(api).call("/v1/me", { bearer: staleToken })).status).toBe(401);
    const owner = await userByEmail(email);
    expect(owner).toMatchObject({ id: stale.id, name: "Victim", emailVerified: true });
    const accounts = await api.db.query.account.findMany({
      where: eq(schema.account.userId, owner.id),
    });
    expect(accounts.map((a) => a.providerId)).toEqual(["credential"]);
  });

  it("changes nothing on a verified account when someone signs up with its email", async () => {
    const owner = TestClient.for(api);
    const { email, password, userId } = await owner.signUp(api, "verified-dup");
    const strangerPassword = freshPassword();
    const sent = api.outbox!.emails.length;
    const dup = await post("/sign-up/email", { email, password: strangerPassword, name: "Other" });
    expect(dup.status).toBe(200);
    expect(((await dup.json()) as { token: unknown }).token).toBeNull();
    expect(api.outbox!.emails.length).toBe(sent + 1); // still mails a code, as for any sign-up

    expect((await signIn(email, strangerPassword)).status).toBe(401);
    expect((await signIn(email, password)).status).toBe(200);
    expect((await owner.call("/v1/me")).status).toBe(200);
    expect(await userByEmail(email)).toMatchObject({ id: userId, name: "verified-dup" });
  });

  it("cannot attach a phone number to an email sign-up", async () => {
    const email = freshEmail("phone-prereg");
    const res = await post("/sign-up/email", {
      email,
      password: freshPassword(),
      name: "Phone",
      phoneNumber: "+15550001111",
    });
    expect(res.status).toBe(400);
    expect(await api.db.query.user.findFirst({ where: eq(schema.user.email, email) })).toBe(
      undefined,
    );
  });
});

describe("deleted account", () => {
  const expectLockedOut = async (email: string, password: string, userId: string) => {
    expect((await signIn(email, password)).status).toBe(403);
    await post("/email-otp/send-verification-otp", { email, type: "sign-in" });
    expect((await post("/sign-in/email-otp", { email, otp: lastOtp(email) })).status).toBe(403);
    await post("/email-otp/send-verification-otp", { email, type: "email-verification" });
    expect((await post("/email-otp/verify-email", { email, otp: lastOtp(email) })).status).toBe(
      403,
    );
    const row = await api.db.query.user.findFirst({ where: eq(schema.user.id, userId) });
    expect(row).toMatchObject({ banned: true, banReason: "self_delete", banExpires: null });
    expect(Date.now() - row!.deletedAt!.getTime()).toBeLessThan(60_000);
    expect(await api.db.$count(schema.session, eq(schema.session.userId, userId))).toBe(0);
  };

  it("stays deleted when its owner signs in again", async () => {
    const client = TestClient.for(api);
    const { email, password, userId } = await client.signUp(api, "undelete");
    expect((await client.call("/v1/me", { method: "DELETE" })).status).toBe(200);
    await expectLockedOut(email, password, userId);
  });

  it("stays deleted after an admin delete", async () => {
    const client = TestClient.for(api);
    const { email, password, userId } = await client.signUp(api, "admin-delete");
    await api.admin.deleteUser(
      {
        adminId: "qa-admin",
        email: "qa@test.invalid",
        role: "admin",
        sessionId: "qa",
        mfaVerified: true,
      },
      userId,
      "qa",
    );
    expect((await client.call("/v1/me")).status).toBe(401);
    await expectLockedOut(email, password, userId);
  });
});

describe("emailed codes", () => {
  it("does not serve the code routes no client uses", async () => {
    for (const path of [
      "/email-otp/check-verification-otp",
      "/forget-password/email-otp",
      "/email-otp/request-email-change",
      "/email-otp/change-email",
    ])
      expect((await post(path, { email: freshEmail("unused"), otp: "000000" })).status).toBe(404);
  });

  it("stores a code only as a hash", async () => {
    const email = freshEmail("hashed");
    await post("/sign-up/email", { email, password: freshPassword(), name: "Hashed" });
    await post("/email-otp/send-verification-otp", { email, type: "sign-in" });
    await post("/email-otp/request-password-reset", { email });
    const codes = api
      .outbox!.emails.filter((m) => m.to === email && m.tag === "otp")
      .map((m) => m.subject.match(/^(\d{6})/)![1]!);
    expect(codes).toHaveLength(3);
    const rows = await api.db.query.verification.findMany();
    const mine = rows.filter((row) => row.identifier.endsWith(email));
    expect(mine).toHaveLength(3);
    for (const row of mine) for (const code of codes) expect(row.value).not.toContain(code);
  });

  it("asks a two-factor account for its second factor instead of signing it in", async () => {
    const { email, userId } = await TestClient.for(api).signUp(api, "otp-2fa");
    await api.db
      .update(schema.user)
      .set({ twoFactorEnabled: true })
      .where(eq(schema.user.id, userId));
    for (const [type, path] of [
      ["sign-in", "/sign-in/email-otp"],
      ["email-verification", "/email-otp/verify-email"],
    ] as const) {
      await post("/email-otp/send-verification-otp", { email, type });
      const client = TestClient.for(api);
      const res = await post(path, { email, otp: lastOtp(email) }, client);
      expect(res.status).toBe(200);
      expect(res.headers.has("set-auth-token")).toBe(false);
      const body = (await res.json()) as { twoFactorRedirect?: boolean; token?: unknown };
      expect(body.twoFactorRedirect).toBe(true);
      expect(body.token == null).toBe(true);
      expect((await client.call("/v1/me")).status).toBe(401);
    }
    expect(await api.db.$count(schema.session, eq(schema.session.userId, userId))).toBe(1);
  });

  it("stops guesses for one email after ten in an hour, from any address", async () => {
    const email = freshEmail("otp-guess");
    await post("/sign-up/email", { email, password: freshPassword(), name: "Guess" });
    for (let guess = 0; guess < 10; guess += 1) {
      // Five wrong guesses burn a code, so a patient attacker asks for a new one.
      if (guess === 5) await post("/email-otp/send-verification-otp", { email, type: "sign-in" });
      const res = await post("/sign-in/email-otp", { email, otp: wrongOtp(lastOtp(email)) });
      expect([400, 403]).toContain(res.status);
    }
    await post("/email-otp/send-verification-otp", { email, type: "sign-in" });
    for (const [path, body] of [
      ["/sign-in/email-otp", {}],
      ["/email-otp/verify-email", {}],
      ["/email-otp/reset-password", { password: freshPassword() }],
    ] as const)
      expect((await post(path, { email, otp: lastOtp(email), ...body })).status).toBe(429);
    // Another email is unaffected.
    const other = freshEmail("otp-other");
    await post("/sign-up/email", { email: other, password: freshPassword(), name: "Other" });
    expect(
      (await post("/email-otp/verify-email", { email: other, otp: lastOtp(other) })).status,
    ).toBe(200);
  });

  it("stops mailing codes to one email after ten in an hour, from any address", async () => {
    const email = freshEmail("otp-flood").toUpperCase();
    const before = api.outbox!.emails.length;
    const statuses: number[] = [];
    for (let request = 0; request < 12; request += 1) {
      const res =
        request % 3 === 0
          ? await post("/sign-up/email", { email, password: freshPassword(), name: "Flood" })
          : request % 3 === 1
            ? await post("/email-otp/send-verification-otp", { email, type: "sign-in" })
            : await post("/email-otp/request-password-reset", { email: email.toLowerCase() });
      statuses.push(res.status);
    }
    expect(statuses).toEqual([...Array.from({ length: 10 }, () => 200), 429, 429]);
    expect(api.outbox!.emails.length).toBe(before + 10);
  });
});

describe("personal organization marker", () => {
  it("cannot be set by creating or updating an organization", async () => {
    const client = TestClient.for(api);
    const { userId, orgId } = await client.signUp(api, "org-marker");
    const slug = `team-${crypto.randomUUID().slice(0, 8)}`;
    const forged = await post(
      "/organization/create",
      { name: "Forged", slug, metadata: { kind: "personal" } },
      client,
    );
    expect(forged.status).toBe(400);

    const created = await post(
      "/organization/create",
      { name: "Team", slug, metadata: { purpose: "team" } },
      client,
    );
    expect(created.status).toBe(200);
    const team = (await created.json()) as { id: string };
    const updated = await post(
      "/organization/update",
      { organizationId: team.id, data: { metadata: { kind: "personal" } } },
      client,
    );
    expect(updated.status).toBe(400);

    const personal = await api.db
      .select({ id: schema.organization.id })
      .from(schema.member)
      .innerJoin(schema.organization, eq(schema.organization.id, schema.member.organizationId))
      .where(
        and(
          eq(schema.member.userId, userId),
          eq(schema.organization.metadata, PERSONAL_ORG_METADATA),
        ),
      );
    expect(personal).toEqual([{ id: orgId }]);
  });
});

describe("phone numbers", () => {
  it("stores and texts one spelling of a number and refuses malformed ones", async () => {
    const digits = String(crypto.getRandomValues(new Uint32Array(1))[0]!)
      .slice(0, 7)
      .padStart(7, "0");
    const phoneNumber = `+1555${digits}`;
    const spaced = `+1 (555) ${digits.slice(0, 3)}-${digits.slice(3)}`;
    expect((await post("/phone-number/send-otp", { phoneNumber: spaced })).status).toBe(200);
    const code = api.outbox!.sms.findLast((sms) => sms.phoneNumber === phoneNumber)!.code!;
    const verified = await post("/phone-number/verify", {
      phoneNumber: `+1-555-${digits}`,
      code,
    });
    expect(verified.status).toBe(200);
    const users = await api.db.query.user.findMany({
      where: eq(schema.user.phoneNumber, phoneNumber),
    });
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({ phoneNumberVerified: true });

    const sent = api.outbox!.sms.length;
    for (const malformed of [`1555${digits}`, `+1555${digits}x`, "+1"])
      expect((await post("/phone-number/send-otp", { phoneNumber: malformed })).status).toBe(400);
    expect(api.outbox!.sms.length).toBe(sent);
  });
});
