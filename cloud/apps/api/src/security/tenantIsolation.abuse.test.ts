/**
 * Red team: tenant isolation at the service layer. Every per-user feature is
 * attacked by two intruders:
 *   - a stranger, a user in a different org;
 *   - a teammate, a second member (role "member") of the victim's own org.
 * A foreign id must fail exactly like an id that does not exist (same status,
 * code and message, so nothing leaks through the error), and the victim's data
 * must be unchanged afterwards. Where a feature is shared on purpose, the test
 * says so and asserts what the code intends.
 */
import { and, eq, inArray } from "drizzle-orm";
import { schema } from "@djl/db";
import { bankExpiresAt, creditsToMicro } from "@djl/domain";
import type { CloudSendMessageInput } from "@djl/contracts/cloud";
import { afterAll, describe, expect, it } from "vitest";

import type { Principal } from "../auth/guard.ts";
import { Settings } from "../config/settings.ts";
import { GatewayService, type RequestFacts } from "../gateway/GatewayService.ts";
import { createMemoryRateLimiter } from "../gateway/RateLimiter.ts";
import { ApiError } from "../http/errors.ts";
import { ImageService } from "../images/ImageService.ts";
import { NotificationService } from "../notifications/NotificationService.ts";
import { PushTokenService } from "../push/PushTokenService.ts";
import { PublishingService } from "../social/publishing/PublishingService.ts";
import type { SocialProvider } from "../social/providers/index.ts";
import { SocialReportService } from "../social/reports/SocialReportService.ts";
import { ReviewLinkService } from "../social/reviews/ReviewLinkService.ts";
import { SocialConnectionService } from "../social/SocialConnectionService.ts";
import { TrackingLinkService } from "../social/tracking/TrackingLinkService.ts";
import { chatHarness } from "../testing/chat.ts";
import { seedOrg } from "../testing/db.ts";
import { planForOrg } from "../usage/plans.ts";
import { UsageService } from "../usage/UsageService.ts";

// ---------------------------------------------------------------------------
// Shared setup
// ---------------------------------------------------------------------------

const h = chatHarness();
afterAll(() => h.close());

const MODEL = "gpt-5-mini";
type Actor = { p: Principal; facts: RequestFacts };

/** A second user who is a plain member of `owner`'s org, acting in that org. */
async function teammateOf(owner: Principal, label: string): Promise<Actor> {
  const personal = await seedOrg(h.db, label);
  await h.db.insert(schema.member).values({
    organizationId: owner.orgId,
    userId: personal.userId,
    role: "member",
    createdAt: new Date(),
  });
  const p: Principal = {
    userId: personal.userId,
    email: `${label}@test.invalid`,
    emailVerified: true,
    banned: false,
    sessionId: "s",
    orgId: owner.orgId,
    role: "member",
    personalOrgId: personal.orgId,
  };
  return { p, facts: { principal: p, traceId: "t", ipHash: null, deviceId: null } };
}

/** The two intruders every feature is tested against. */
async function intruders(victim: Principal, label: string): Promise<[string, Actor][]> {
  return [
    ["stranger", await h.user(`${label}-stranger`)],
    ["teammate", await teammateOf(victim, `${label}-mate`)],
  ];
}

async function failure(promise: Promise<unknown>): Promise<ApiError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ApiError);
  return error as ApiError;
}

/** `attempt(foreignId)` must fail exactly like `attempt(<an id that does not exist>)`: a 404. */
async function sameAsMissing(
  who: string,
  attempt: (id: string) => Promise<unknown>,
  foreignId: string,
): Promise<void> {
  const foreign = await failure(attempt(foreignId));
  const missing = await failure(attempt(crypto.randomUUID()));
  expect({ who, status: missing.status }).toEqual({ who, status: 404 });
  expect({ who, status: foreign.status, code: foreign.code, message: foreign.message }).toEqual({
    who,
    status: missing.status,
    code: missing.code,
    message: missing.message,
  });
}

const message = (text: string, parentId: string | null = null, mode: "chat" | "task" = "chat") =>
  ({
    clientMessageId: crypto.randomUUID(),
    parentId,
    parts: [{ type: "text", text }],
    model: MODEL,
    mode,
  }) as unknown as CloudSendMessageInput;

/** A victim with one finished chat exchange whose text contains a unique word. */
async function victimChat(label: string) {
  const owner = await h.user(label);
  const secret = `secret${crypto.randomUUID().replaceAll("-", "")}`;
  const conversation = await h.chat.create(owner.p, { title: `Private ${label}` } as never);
  const sent = await h.chat.send(owner.facts, conversation.id, message(`hello ${secret}`));
  await h.runner.idle();
  return { owner, secret, conversation, sent };
}

/** The victim's conversation, exactly as the victim sees it. */
const snapshot = async (owner: Actor, conversationId: string) => {
  const { conversation, messages } = await h.chat.get(owner.p, conversationId);
  const runs = await h.db
    .select({ id: schema.runs.id, status: schema.runs.status })
    .from(schema.runs)
    .where(eq(schema.runs.conversationId, conversationId));
  return { conversation, messages, runs };
};

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

describe("chat: conversations and messages", () => {
  it("intruders cannot read, list, search, send into, branch, rename, delete or claim a conversation", async () => {
    const v = await victimChat("iso-chat");
    const before = await snapshot(v.owner, v.conversation.id);
    const id = v.conversation.id;

    for (const [who, a] of await intruders(v.owner.p, "iso-chat")) {
      await sameAsMissing(who, (x) => h.chat.get(a.p, x), id);
      await sameAsMissing(who, (x) => h.chat.branch(a.p, x), id);
      await sameAsMissing(who, (x) => h.chat.update(a.p, x, { title: "pwned" } as never), id);
      await sameAsMissing(who, (x) => h.chat.remove(a.p, x), id);
      await sameAsMissing(who, (x) => h.chat.send(a.facts, x, message("injected")), id);
      await sameAsMissing(
        who,
        (x) => h.chat.send(a.facts, x, message("injected", v.sent.reply.id)),
        id,
      );
      await sameAsMissing(who, (x) => h.chat.regenerate(a.facts, x, v.sent.reply.id, {}), id);
      // Reusing the victim's id as a client-chosen conversation id must not hand it over.
      // (A fresh id legitimately creates a conversation, so there is no "missing" twin here.)
      const claim = await failure(h.chat.create(a.p, { clientConversationId: id } as never));
      expect({ who, status: claim.status, code: claim.code }).toEqual({
        who,
        status: 404,
        code: "not_found",
      });

      const listed = await h.chat.list(a.p, {});
      expect(listed.conversations.map((c) => c.id)).not.toContain(id);
      expect((await h.chat.search(a.p, { q: v.secret } as never)).results).toEqual([]);
    }

    expect(await snapshot(v.owner, id)).toEqual(before);
    expect((await h.chat.search(v.owner.p, { q: v.secret } as never)).results).toHaveLength(1);
  });

  it("intruders cannot graft the victim's messages into their own conversation", async () => {
    const v = await victimChat("iso-graft");
    const before = await snapshot(v.owner, v.conversation.id);

    for (const [who, a] of await intruders(v.owner.p, "iso-graft")) {
      const own = await h.chat.create(a.p, {});
      // Reply under, switch to, or regenerate one of the victim's messages.
      await sameAsMissing(
        who,
        (x) => h.chat.send(a.facts, own.id, message("graft", x)),
        v.sent.reply.id,
      );
      await sameAsMissing(
        who,
        (x) => h.chat.update(a.p, own.id, { branchMessageId: x } as never),
        v.sent.reply.id,
      );
      await sameAsMissing(who, (x) => h.chat.regenerate(a.facts, own.id, x, {}), v.sent.reply.id);
      expect((await h.chat.get(a.p, own.id)).messages).toEqual([]);
    }

    expect(await snapshot(v.owner, v.conversation.id)).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// Files (the cross-org case lives in FileService.test.ts; this adds the teammate)
// ---------------------------------------------------------------------------

describe("files", () => {
  it("intruders cannot complete or download another user's file", async () => {
    const owner = await h.user("iso-file");
    const pdf = new TextEncoder().encode("%PDF-1.7 private body");
    const upload = await h.uploadFile(owner.p, pdf, { mimeType: "application/pdf" });
    await upload.complete();

    for (const [who, a] of await intruders(owner.p, "iso-file")) {
      await sameAsMissing(who, (x) => h.files.complete(a.p, x), upload.id);
      await sameAsMissing(who, (x) => h.files.downloadUrl(a.p, x), upload.id);
    }

    expect((await h.files.downloadUrl(owner.p, upload.id)).url).toContain(upload.id);
  });
});

// ---------------------------------------------------------------------------
// Shares
// ---------------------------------------------------------------------------

describe("shares", () => {
  it("intruders cannot share, list or revoke another user's conversation or share", async () => {
    const v = await victimChat("iso-share");
    const created = await h.shares.create(v.owner.p, v.conversation.id, {});
    const token = created.url.split("/share/")[1]!;

    for (const [who, a] of await intruders(v.owner.p, "iso-share")) {
      await sameAsMissing(who, (x) => h.shares.create(a.p, x, {}), v.conversation.id);
      // Snapshotting the victim's branch through the intruder's own conversation.
      const own = await h.chat.create(a.p, {});
      await sameAsMissing(
        who,
        (x) => h.shares.create(a.p, own.id, { messageId: x } as never),
        v.sent.reply.id,
      );
      await sameAsMissing(who, (x) => h.shares.revoke(a.p, x), created.share.id);
      expect((await h.shares.list(a.p)).shares).toEqual([]);
    }

    const [mine] = (await h.shares.list(v.owner.p)).shares;
    expect(mine).toMatchObject({ id: created.share.id, revokedAt: null });
    expect((await h.shares.view(token)).messages.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

describe("runs", () => {
  it("intruders cannot read, stream or cancel another user's run", async () => {
    const v = await victimChat("iso-run");
    // A task run nobody executes here stays queued, so a cancel would visibly land.
    const queued = await h.chat.send(
      v.owner.facts,
      v.conversation.id,
      message("long task", v.sent.reply.id, "task"),
    );
    const ac = new AbortController();

    for (const [who, a] of await intruders(v.owner.p, "iso-run")) {
      for (const runId of [v.sent.run.id, queued.run.id]) {
        await sameAsMissing(who, (x) => h.runs.get(a.p, x), runId);
        await sameAsMissing(who, (x) => h.runs.events(a.p, x, 0), runId);
        await sameAsMissing(who, (x) => h.runs.stream(a.p, x, 0, ac.signal), runId);
        await sameAsMissing(who, (x) => h.runs.cancel(a.p, x), runId);
      }
    }
    ac.abort();

    expect((await h.runs.get(v.owner.p, v.sent.run.id)).run.status).toBe("succeeded");
    const still = await h.db.query.runs.findFirst({ where: eq(schema.runs.id, queued.run.id) });
    expect(still).toMatchObject({ status: "queued", cancelRequestedAt: null });
    // The owner can still cancel it, so the 404s above were not a broken cancel.
    expect((await h.runs.cancel(v.owner.p, queued.run.id)).run.status).toBe("cancelled");
  });
});

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

describe("notifications", () => {
  const notifications = new NotificationService(h.db);

  it("intruders cannot see or mark another user's task notification", async () => {
    const v = await victimChat("iso-note");
    const task = await h.chat.send(
      v.owner.facts,
      v.conversation.id,
      message("task", v.sent.reply.id, "task"),
    );
    await h.db
      .update(schema.runs)
      .set({ status: "succeeded", finishedAt: new Date() })
      .where(eq(schema.runs.id, task.run.id));
    expect((await notifications.list(v.owner.p)).notifications.map((n) => n.id)).toEqual([
      task.run.id,
    ]);

    for (const [who, a] of await intruders(v.owner.p, "iso-note")) {
      const listed = await notifications.list(a.p);
      expect(listed.notifications).toEqual([]);
      expect(listed.unreadCount).toBe(0);
      await sameAsMissing(who, (x) => notifications.markRead(a.p, [x]), task.run.id);
      const receipts = await h.db
        .select()
        .from(schema.notificationReads)
        .where(eq(schema.notificationReads.runId, task.run.id));
      expect(receipts).toEqual([]);
    }

    expect(await notifications.unreadCount(v.owner.p)).toBe(1);
    expect((await notifications.markRead(v.owner.p, [task.run.id])).unreadCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Push tokens
// ---------------------------------------------------------------------------

const apnsToken = () => crypto.randomUUID().replaceAll("-", "").repeat(2);

describe("push tokens", () => {
  const push = new PushTokenService(h.db);

  it("intruders cannot bind a token to another user's device", async () => {
    const owner = await h.user("iso-push");
    const [device] = await h.db
      .insert(schema.devices)
      .values({ userId: owner.p.userId, kind: "ios", fingerprint: crypto.randomUUID() })
      .returning();

    for (const [who, a] of await intruders(owner.p, "iso-push")) {
      for (const provider of ["apns", "fcm"] as const) {
        const token = apnsToken();
        await sameAsMissing(
          `${who}/${provider}`,
          (x) =>
            push.register(a.p, {
              ...(provider === "fcm" ? { provider } : {}),
              token,
              environment: "production",
              deviceId: x,
            } as never),
          device!.id,
        );
        expect(
          await h.db.select().from(schema.pushTokens).where(eq(schema.pushTokens.token, token)),
        ).toEqual([]);
        expect(
          await h.db
            .select()
            .from(schema.fcmInstallations)
            .where(eq(schema.fcmInstallations.installationId, token)),
        ).toEqual([]);
      }
    }
  });

  // Deliberate (see the PushTokenService header): a token belongs to whoever
  // registered it last, so a phone that signs in as someone else stops getting
  // the previous account's pushes. Taking over a token therefore requires
  // knowing the device's 64-hex APNs token. There is no delete method to abuse:
  // tokens are only registered or moved, never removed by id.
  it("a re-registered token moves to the caller, as designed", async () => {
    const owner = await h.user("iso-push-move");
    const token = apnsToken();
    await push.register(owner.p, { token, environment: "production" } as never);
    for (const [, a] of await intruders(owner.p, "iso-push-move")) {
      await push.register(a.p, { token, environment: "production" } as never);
      const rows = await h.db
        .select()
        .from(schema.pushTokens)
        .where(eq(schema.pushTokens.token, token));
      expect(rows.map((r) => r.userId)).toEqual([a.p.userId]);
    }
  });
});

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

describe("images", () => {
  const images = new ImageService({
    db: h.db,
    chat: h.chat,
    gateway: {
      listModels: async () => [
        { id: "gpt-image-1", capabilities: ["image.generate"], status: "active" },
      ],
    } as never,
  });

  it("intruders cannot list, download or generate into another user's images", async () => {
    const v = await victimChat("iso-image");
    const [file] = await h.db
      .insert(schema.files)
      .values({
        orgId: v.owner.p.orgId,
        userId: v.owner.p.userId,
        name: "generated.png",
        mimeType: "image/png",
        sizeBytes: 3,
        storageKey: `org/${v.owner.p.orgId}/files/${crypto.randomUUID()}`,
        status: "ready",
        source: "generated",
        purpose: "image",
        messageId: v.sent.reply.id,
      })
      .returning();
    const before = await snapshot(v.owner, v.conversation.id);

    for (const [who, a] of await intruders(v.owner.p, "iso-image")) {
      expect((await images.list(a.p)).images).toEqual([]);
      await sameAsMissing(who, (x) => h.files.downloadUrl(a.p, x), file!.id);
      await sameAsMissing(
        who,
        (x) =>
          images.create(a.facts, x, {
            clientMessageId: crypto.randomUUID(),
            prompt: "a red door",
            aspectRatio: "1:1",
          }),
        v.conversation.id,
      );
    }

    expect((await images.list(v.owner.p)).images.map((i) => i.fileId)).toEqual([file!.id]);
    expect(await snapshot(v.owner, v.conversation.id)).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// Usage
// ---------------------------------------------------------------------------

describe("usage", () => {
  const usage = new UsageService(h.db);

  async function spend(p: Principal, credits: number) {
    const id = crypto.randomUUID();
    const { windowCaps } = await planForOrg(h.db, p.orgId, new Date());
    const amount = creditsToMicro(credits);
    await h.ledger.reserve({
      orgId: p.orgId,
      reservationId: id,
      estimate: amount,
      idempotencyKey: `r:${id}`,
      actor: "test",
      window: { userId: p.userId, caps: windowCaps, partial: true },
    });
    await h.ledger.settle({
      orgId: p.orgId,
      reservationId: id,
      actual: amount,
      idempotencyKey: `r:${id}`,
      actor: "test",
    });
  }

  // The routes always pass the caller's own ids (p.userId, p.orgId); this
  // proves the windows and banks behind those ids are per user, also inside
  // one org that shares a plan and a credit balance.
  it("intruders see none of another user's window spend and cannot redeem their banks", async () => {
    const owner = await h.user("iso-usage");
    await spend(owner.p, 3);
    const grantedAt = new Date();
    const [bank] = await h.db
      .insert(schema.resetBanks)
      .values({
        userId: owner.p.userId,
        source: "admin",
        grantedBy: "admin:test",
        grantedAt,
        expiresAt: bankExpiresAt(grantedAt),
        idempotencyKey: `test:${crypto.randomUUID()}`,
      })
      .returning();

    for (const [who, a] of await intruders(owner.p, "iso-usage")) {
      const view = await usage.windows(a.p.userId, a.p.orgId);
      expect({ who, five: view.windows.fiveHour.used, week: view.windows.week.used }).toEqual({
        who,
        five: 0n,
        week: 0n,
      });
      expect(view.banks.count).toBe(0);
      const error = await failure(usage.redeem(a.p.userId, a.p.orgId, crypto.randomUUID()));
      expect(error.code).toBe("no_reset_bank");
    }

    const mine = await usage.windows(owner.p.userId, owner.p.orgId);
    expect(mine.windows.week.used).toBe(creditsToMicro(3));
    expect((await usage.banks(owner.p.userId)).map((b) => b.id)).toEqual([bank!.id]);
  });

  // Gateway usage (GET /v1/usage) is keyed only by org on purpose: it is the
  // org's billing dashboard (credits are org-level) and carries no prompt or
  // reply content and no user id. A stranger's org sees nothing; a teammate
  // sees the org's rows by design.
  it("another org cannot read an org's gateway usage; a teammate shares it by design", async () => {
    const gateway = new GatewayService({
      db: h.db,
      ledger: h.ledger,
      limiter: createMemoryRateLimiter(),
      settings: new Settings(h.db, { ttlMs: 0 }),
      providers: {},
      trial: { onFirstCloudRequest: async () => false },
      config: { region: "test", catalogTtlMs: 0, refusalFlagThreshold: 100 },
    });
    const v = await victimChat("iso-gateway-usage");
    const mine = await gateway.usage(v.owner.p.orgId);
    expect(mine.length).toBeGreaterThan(0);
    const ids = mine.map((r) => r.id);

    const stranger = await h.user("iso-gateway-usage-stranger");
    expect(await gateway.usage(stranger.p.orgId)).toEqual([]);
    expect([...(await gateway.usageByModel(stranger.p.orgId))]).toEqual([]);

    const mate = await teammateOf(v.owner.p, "iso-gateway-usage-mate");
    expect((await gateway.usage(mate.p.orgId)).map((r) => r.id)).toEqual(ids);
  });
});

// ---------------------------------------------------------------------------
// Social: shared fixtures
// ---------------------------------------------------------------------------

const instagram: SocialProvider = {
  id: "instagram",
  authorizationUrl: ({ state }) => `https://example.invalid/authorize?state=${state}`,
  exchangeCode: async () => ({
    accessToken: "secret-access",
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    scope: ["publish"],
  }),
  refresh: async (tokens) => tokens,
  revoke: async () => {},
  account: async () => ({
    id: "provider-user",
    username: "tester",
    displayName: "Test",
    scopes: ["publish"],
    capabilities: { publish: true, metrics: false },
  }),
};
const connections = new SocialConnectionService(
  h.db,
  { instagram },
  { enabled: true, encryptionKey: "ab".repeat(32), publicUrl: "https://api.example.invalid" },
);
const publishing = new PublishingService(h.db, h.blobs);
const JPEG = new Uint8Array([255, 216, 255]);

/** A connected Instagram account and a ready JPEG owned by `p`, and a draft input using both. */
async function publisher(p: Principal, threadId = `thread-${crypto.randomUUID()}`) {
  const [account] = await h.db
    .insert(schema.socialAccounts)
    .values({
      userId: p.userId,
      orgId: p.orgId,
      provider: "instagram",
      providerAccountId: crypto.randomUUID(),
      username: "test",
      displayName: "test",
      scopes: [],
      capabilities: { publish: true, metrics: false },
      status: "connected",
      expiresAt: new Date(Date.now() + 3_600_000),
    })
    .returning();
  const storageKey = `org/${p.orgId}/files/${crypto.randomUUID()}`;
  h.blobs.put(storageKey, JPEG, "image/jpeg");
  const [file] = await h.db
    .insert(schema.files)
    .values({
      userId: p.userId,
      orgId: p.orgId,
      name: "photo.jpg",
      mimeType: "image/jpeg",
      sizeBytes: JPEG.byteLength,
      sha256: Buffer.from(await crypto.subtle.digest("SHA-256", JPEG)).toString("hex"),
      purpose: "image",
      storageKey,
      status: "ready",
    })
    .returning();
  const input = {
    threadId,
    caption: "hello",
    captions: { [account!.id]: "hello" },
    accountIds: [account!.id],
    mediaFileIds: [file!.id],
    publicationMode: "now" as const,
    scheduledAt: new Date(Date.now() - 1000).toISOString(),
    timezone: "America/Toronto",
  };
  return { accountId: account!.id, fileId: file!.id, input };
}

/** A victim with a confirmed draft (one queued publish task). */
async function victimDraft(label: string) {
  const owner = await h.user(label);
  const fixture = await publisher(owner.p);
  const draft = await publishing.create(owner.p, fixture.input as never);
  const confirmed = await publishing.confirm(owner.p, draft.id, 1);
  return { owner, fixture, draft: confirmed, taskId: confirmed.tasks[0]!.id };
}

// ---------------------------------------------------------------------------
// Social: connections
// ---------------------------------------------------------------------------

describe("social connections", () => {
  it("intruders cannot see, reconnect, use or disconnect another user's connection", async () => {
    const owner = await h.user("iso-social");
    const start = await connections.start(owner.p, {
      provider: "instagram",
      threadId: "thread",
      campaignId: "campaign",
      revision: 1,
    });
    const state = new URL(start.authorizationUrl).searchParams.get("state")!;
    await connections.callback(owner.p, "instagram", { state, code: "code" });
    const accountId = (await connections.status(owner.p, start.attemptId)).accountId!;

    for (const [who, a] of await intruders(owner.p, "iso-social")) {
      await sameAsMissing(who, (x) => connections.status(a.p, x), start.attemptId);
      await sameAsMissing(
        who,
        (x) =>
          connections.start(a.p, {
            provider: "instagram",
            threadId: "thread",
            campaignId: "campaign",
            revision: 1,
            accountId: x,
          } as never),
        accountId,
      );
      await sameAsMissing(
        who,
        (x) => connections.withAccountCredentials(a.p, x, async () => "stolen"),
        accountId,
      );
      await sameAsMissing(who, (x) => connections.creatorInfo(a.p, x), accountId);
      await sameAsMissing(who, (x) => connections.disconnect(a.p, x), accountId);
      expect((await connections.list(a.p)).accounts).toEqual([]);
      expect((await connections.listAttempts(a.p, "thread", "campaign")).attempts).toEqual([]);
    }

    expect((await connections.list(owner.p)).accounts).toMatchObject([
      { id: accountId, status: "connected" },
    ]);
    const token = await connections.withAccountCredentials(
      owner.p,
      accountId,
      async ({ tokens }) => tokens.accessToken,
    );
    expect(token).toBe("secret-access");
  });
});

// ---------------------------------------------------------------------------
// Social: publishing
// ---------------------------------------------------------------------------

describe("social publishing", () => {
  it("intruders cannot read, edit, confirm, cancel or measure another user's post", async () => {
    const v = await victimDraft("iso-publish");

    for (const [who, a] of await intruders(v.owner.p, "iso-publish")) {
      // The intruder's own valid accounts and media, so only the draft id is foreign.
      const own = await publisher(a.p, v.fixture.input.threadId);
      await sameAsMissing(who, (x) => publishing.get(a.p, x), v.draft.id);
      await sameAsMissing(who, (x) => publishing.edit(a.p, x, 2, own.input as never), v.draft.id);
      await sameAsMissing(who, (x) => publishing.confirm(a.p, x, 2), v.draft.id);
      await sameAsMissing(who, (x) => publishing.action(a.p, x, 2, "cancel"), v.taskId);
      await sameAsMissing(who, (x) => publishing.action(a.p, x, 2, "retry"), v.taskId);
      await sameAsMissing(who, (x) => publishing.metrics(a.p, x), v.taskId);
      // Same thread id as the victim, yet the intruder lists none of the victim's drafts.
      expect(await publishing.list(a.p, v.fixture.input.threadId)).toEqual([]);

      // Drafting with the victim's account or media is refused like a missing one.
      const withAccount = { ...own.input, accountIds: [v.fixture.accountId] };
      withAccount.captions = { [v.fixture.accountId]: "hello" };
      expect((await failure(publishing.create(a.p, withAccount as never))).code).toBe(
        "account_unavailable",
      );
      const withMedia = { ...own.input, mediaFileIds: [v.fixture.fileId] };
      expect((await failure(publishing.create(a.p, withMedia as never))).code).toBe(
        "media_unavailable",
      );
    }

    const after = await publishing.get(v.owner.p, v.draft.id);
    expect(after.revision).toBe(1);
    expect(after.confirmedAt).toEqual(v.draft.confirmedAt);
    expect(after.tasks.map((t) => [t.id, t.state])).toEqual([[v.taskId, "queued"]]);
  });
});

// ---------------------------------------------------------------------------
// Social: review links
// ---------------------------------------------------------------------------

describe("social review links", () => {
  const reviews = new ReviewLinkService(h.db, h.blobs);
  const linkInput = { revision: 1, expiresInHours: 24, disclosureAccepted: true } as const;

  it("intruders cannot create, list or revoke review links on another user's draft", async () => {
    const owner = await h.user("iso-review");
    const fixture = await publisher(owner.p);
    const draft = await publishing.create(owner.p, fixture.input as never);
    const created = await reviews.create(owner.p, draft.id, linkInput);

    for (const [who, a] of await intruders(owner.p, "iso-review")) {
      await sameAsMissing(who, (x) => reviews.create(a.p, x, linkInput), draft.id);
      await sameAsMissing(who, (x) => reviews.list(a.p, x), draft.id);
      await sameAsMissing(who, (x) => reviews.revoke(a.p, x), created.link.id);
    }

    const [link] = await reviews.list(owner.p, draft.id);
    expect(link).toMatchObject({ id: created.link.id, revokedAt: null });
    expect((await reviews.read(created.token)).caption).toBe("hello");
  });
});

// ---------------------------------------------------------------------------
// Social: tracking links
// ---------------------------------------------------------------------------

describe("social tracking links", () => {
  const tracking = new TrackingLinkService(h.db);
  const linkInput = {
    url: "https://example.com/offer?utm_source=instagram",
    campaignId: "same-campaign",
    threadId: "same-thread",
    contentRevision: 1,
    expiresInDays: 7 as const,
    disclosureAccepted: true,
  };

  it("intruders cannot read, list or revoke another user's tracking link", async () => {
    const owner = await h.user("iso-tracking");
    const created = await tracking.create(owner.p, linkInput);
    const slug = created.publicPath.split("/l/")[1]!;
    await tracking.open(slug, true);

    for (const [who, a] of await intruders(owner.p, "iso-tracking")) {
      await sameAsMissing(who, (x) => tracking.get(a.p, x), created.link.id);
      await sameAsMissing(who, (x) => tracking.revoke(a.p, x), created.link.id);
      expect(await tracking.list(a.p, { campaignId: linkInput.campaignId })).toEqual([]);
    }

    expect(await tracking.get(owner.p, created.link.id)).toMatchObject({
      revokedAt: null,
      linkOpens: 1,
    });
    expect(await tracking.open(slug, false)).toBe(linkInput.url);
  });
});

// ---------------------------------------------------------------------------
// Social: weekly reports
// ---------------------------------------------------------------------------

describe("social weekly reports", () => {
  const reports = new SocialReportService(h.db, publishing);
  const weekly = { enabled: true, timezone: "America/Toronto", weekday: 1, hour: 9, minute: 0 };
  // Enabled schedules are global work for the report worker; remove them so later test
  // files that list every due schedule start from a clean slate.
  const createdSchedules: string[] = [];
  afterAll(async () => {
    if (createdSchedules.length > 0)
      await h.db
        .delete(schema.socialReportSchedules)
        .where(inArray(schema.socialReportSchedules.id, createdSchedules));
  });

  it("intruders cannot read or change another user's report schedule, even on the same thread", async () => {
    const v = await victimDraft("iso-report");
    const scheduled = await reports.setSchedule(v.owner.p, v.draft.id, weekly);
    createdSchedules.push(scheduled.schedule.id!);
    const [report] = await h.db
      .insert(schema.socialWeeklyReports)
      .values({
        scheduleId: scheduled.schedule.id!,
        orgId: v.owner.p.orgId,
        userId: v.owner.p.userId,
        threadId: v.fixture.input.threadId,
        periodStart: new Date(Date.now() - 7 * 86_400_000),
        periodEnd: new Date(),
        retrievedAt: new Date(),
        content: { id: crypto.randomUUID(), threadId: v.fixture.input.threadId } as never,
      })
      .returning();
    const before = await reports.getState(v.owner.p, v.draft.id);

    for (const [who, a] of await intruders(v.owner.p, "iso-report")) {
      await sameAsMissing(who, (x) => reports.getState(a.p, x), v.draft.id);
      await sameAsMissing(who, (x) => reports.getSchedule(a.p, x), v.draft.id);
      await sameAsMissing(
        who,
        (x) => reports.setSchedule(a.p, x, { ...weekly, enabled: false }),
        v.draft.id,
      );
      // The intruder's own draft on the victim's thread id gets its own, empty state.
      const own = await publisher(a.p, v.fixture.input.threadId);
      const ownDraft = await publishing.create(a.p, own.input as never);
      const ownState = await reports.setSchedule(a.p, ownDraft.id, { ...weekly, hour: 3 });
      createdSchedules.push(ownState.schedule.id!);
      expect(ownState.schedule.id).not.toBe(scheduled.schedule.id);
      expect(ownState.reports).toEqual([]);
    }

    expect(await reports.getState(v.owner.p, v.draft.id)).toEqual(before);
    expect(before.reports).toHaveLength(1);
    expect(before.schedule).toMatchObject({ enabled: true, hour: 9 });
    const rows = await h.db
      .select()
      .from(schema.socialWeeklyReports)
      .where(
        and(
          eq(schema.socialWeeklyReports.id, report!.id),
          eq(schema.socialWeeklyReports.userId, v.owner.p.userId),
        ),
      );
    expect(rows).toHaveLength(1);
  });
});
