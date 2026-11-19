import { it, assert } from "@effect/vitest";
import { Effect } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { createCampaign, reviseCampaign } from "@synara/contracts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite";
import { saveDocument } from "./store";
import { agentOwnerFromSession } from "./agentScope";
import { publishingBridge } from "./publishingBridge";
import { createSocialCloudClient } from "./socialCloudClient";
const config = { stateDir: "/unused", secretsDir: "/actual/secrets" };
const session = {
  apiBaseUrl: "https://cloud.test",
  token: "private-token",
  userId: "u",
  orgId: "team-org",
  email: "",
  createdAt: "",
};
it.layer(SqlitePersistenceMemory)("local publishing cloud bridge", (it) => {
  it.effect("binds review, recap and tracking actions to this user's exact chat and version", () =>
    Effect.gen(function* () {
      const campaign = {
        ...createCampaign("Extras"),
        ownerKey: agentOwnerFromSession(session).key,
        threadId: "extras-chat",
      };
      yield* saveDocument("campaign", campaign.id, campaign, null);
      yield* saveDocument(
        "social-draft-link",
        "extras-draft",
        {
          apiBaseUrl: session.apiBaseUrl,
          userId: session.userId,
          orgId: session.orgId,
          campaignId: campaign.id,
          campaignRevision: campaign.revision,
          draftId: "extras-draft",
          cloudRevision: 1,
        },
        null,
      );
      let foreign = false;
      const calls: { path: string; body?: unknown }[] = [];
      const deps = {
        session: async () => session,
        client: () => ({
          baseUrl: session.apiBaseUrl,
          get: async (path: string) => {
            calls.push({ path });
            if (path.endsWith("/reports")) return { schedule: null, reports: [] };
            if (path.includes("tracking-links"))
              return [{ id: "owned-link", campaignId: campaign.id, threadId: campaign.threadId }];
            if (path.endsWith("/review-links")) return [];
            return {
              id: "extras-draft",
              revision: 1,
              userId: foreign ? "other-user" : session.userId,
              orgId: session.orgId,
              threadId: campaign.threadId,
            };
          },
          post: async (path: string, body: unknown) => {
            calls.push({ path, body });
            return path.includes("tracking-links")
              ? {
                  link: { id: "created" },
                  publicPath: "/l/aaaaaaaaaaaaaaaaaaaaaa",
                  trackingUrl: "https://staging.slcor.com/l/aaaaaaaaaaaaaaaaaaaaaa",
                }
              : {
                  link: { id: "review", revision: 1 },
                  reviewUrl:
                    "https://staging.slcor.com/social/review#token=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                  reviewPath: "/social/review#token=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                };
          },
        }),
        fetch: async (_url: string, init: RequestInit) => {
          calls.push({
            path: init.method!,
            body: init.body ? JSON.parse(init.body as string) : null,
          });
          return Response.json({ updated: true });
        },
      };
      const request = {
        campaignId: campaign.id,
        threadId: campaign.threadId,
        version: 1,
        draftId: "extras-draft",
        revision: 1,
      };
      const reviews = yield* publishingBridge(
        config,
        { ...request, action: "review-links" },
        deps as never,
      );
      assert.deepEqual(reviews, []);
      const recap = yield* publishingBridge(
        config,
        { ...request, action: "report-state" },
        deps as never,
      );
      assert.deepEqual(recap, { schedule: null, reports: [] });
      const beforeMissingConsent = calls.length;
      yield* publishingBridge(
        config,
        { ...request, action: "create-review-link", expiresInHours: 24 },
        deps as never,
      ).pipe(Effect.flip);
      assert.isFalse(calls.slice(beforeMissingConsent).some((call) => call.body));
      const shared = yield* publishingBridge(
        config,
        { ...request, action: "create-review-link", expiresInHours: 24, disclosureAccepted: true },
        deps as never,
      );
      assert.match(
        (shared as any).reviewUrl,
        /^https:\/\/staging\.slcor\.com\/social\/review#token=/,
      );
      yield* publishingBridge(
        config,
        {
          ...request,
          action: "report-schedule",
          schedule: { enabled: true, timezone: "UTC", weekday: 1, hour: 9, minute: 0 },
        },
        deps as never,
      );
      assert.deepEqual(calls.at(-1), {
        path: "PUT",
        body: { enabled: true, timezone: "UTC", weekday: 1, hour: 9, minute: 0 },
      });
      const tracked = yield* publishingBridge(
        config,
        {
          ...request,
          action: "create-tracking-link",
          url: "https://example.com/product",
          expiresInDays: 30,
          disclosureAccepted: true,
        },
        deps as never,
      );
      assert.strictEqual(
        (tracked as any).trackingUrl,
        "https://staging.slcor.com/l/aaaaaaaaaaaaaaaaaaaaaa",
      );
      assert.deepEqual(calls.at(-1)?.body, {
        url: "https://example.com/product",
        campaignId: campaign.id,
        threadId: campaign.threadId,
        contentRevision: campaign.revision,
        expiresInDays: 30,
        disclosureAccepted: true,
      });
      yield* publishingBridge(
        config,
        { ...request, action: "revoke-tracking-link", linkId: "foreign-link" },
        deps as never,
      ).pipe(Effect.flip);
      assert.notEqual(calls.at(-1)?.path, "DELETE");
      foreign = true;
      yield* publishingBridge(config, { ...request, action: "report-state" }, deps as never).pipe(
        Effect.flip,
      );
      assert.strictEqual(calls.at(-1)?.path, "/v1/social/drafts/extras-draft");
      const beforeStale = calls.length;
      yield* publishingBridge(
        config,
        {
          ...request,
          action: "create-tracking-link",
          version: 0,
          url: "https://example.com",
          expiresInDays: 30,
          disclosureAccepted: true,
        },
        deps as never,
      ).pipe(Effect.flip);
      assert.strictEqual(calls.length, beforeStale);
    }),
  );
  it.effect("authorizes a later carousel image before reading or uploading the first", () =>
    Effect.gen(function* () {
      const ids: string[] = [crypto.randomUUID(), crypto.randomUUID()];
      const ownerKey = agentOwnerFromSession(session).key;
      const campaign = {
        ...createCampaign("Denied carousel"),
        ownerKey,
        threadId: "denied-carousel",
        platforms: ["instagram"],
        assetIds: ids,
      };
      yield* saveDocument("campaign", campaign.id, campaign, null);
      yield* saveDocument("asset", ids[0]!, { id: ids[0], mime: "image/jpeg", ownerKey }, null);
      yield* saveDocument(
        "asset",
        ids[1]!,
        { id: ids[1], mime: "image/jpeg", ownerKey: "foreign" },
        null,
      );
      let reads = 0;
      const deps = {
        session: async () => session,
        readFile: async () => {
          reads++;
          return Buffer.alloc(0);
        },
        client: () => ({
          get: async () => ({
            accounts: [
              {
                id: "account",
                provider: "instagram",
                status: "connected",
                capabilities: { publish: true },
              },
            ],
          }),
        }),
      };
      yield* publishingBridge(
        config,
        {
          action: "prepare",
          campaignId: campaign.id,
          threadId: campaign.threadId,
          version: 1,
          accountIds: ["account"],
          publicationMode: "now",
          timezone: "UTC",
        },
        deps as never,
      ).pipe(Effect.flip);
      assert.strictEqual(reads, 0);
    }),
  );
  it.effect("rejects campaign edits occurring after initial read and before confirmation", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const campaign = {
        ...createCampaign("race"),
        ownerKey: agentOwnerFromSession(session).key,
        threadId: "thread-race",
        platforms: ["instagram"],
      };
      yield* saveDocument("campaign", campaign.id, campaign, null);
      yield* saveDocument(
        "social-draft-link",
        "draft-race",
        {
          apiBaseUrl: session.apiBaseUrl,
          userId: session.userId,
          orgId: session.orgId,
          campaignId: campaign.id,
          campaignRevision: campaign.revision,
          draftId: "draft-race",
          cloudRevision: 1,
        },
        null,
      );
      let sent = 0;
      const deps = {
        session: async () => {
          await Effect.runPromise(
            saveDocument(
              "campaign",
              campaign.id,
              reviseCampaign(campaign, { captions: { instagram: "new content" } }),
              1,
            ).pipe(Effect.provideService(SqlClient.SqlClient, sql)),
          );
          return session;
        },
        client: () => ({
          post: async () => {
            sent++;
            return {};
          },
        }),
      };
      const error = yield* publishingBridge(
        config,
        {
          action: "confirm",
          campaignId: campaign.id,
          threadId: campaign.threadId,
          version: 1,
          draftId: "draft-race",
          revision: 1,
        },
        deps as never,
      ).pipe(Effect.flip);
      assert.include(String(error), "changed");
      assert.strictEqual(sent, 0);
    }),
  );
  it.effect("rejects identical user/org identifiers from a different cloud endpoint", () =>
    Effect.gen(function* () {
      const campaign = {
        ...createCampaign("cloud-switch"),
        ownerKey: agentOwnerFromSession(session).key,
        threadId: "thread-cloud",
        platforms: ["instagram"],
      };
      yield* saveDocument("campaign", campaign.id, campaign, null);
      yield* saveDocument(
        "social-draft-link",
        "draft-cloud",
        {
          apiBaseUrl: "https://old-cloud.test",
          userId: session.userId,
          orgId: session.orgId,
          campaignId: campaign.id,
          campaignRevision: campaign.revision,
          draftId: "draft-cloud",
          cloudRevision: 1,
        },
        null,
      );
      let sent = 0;
      const deps = {
        session: async () => session,
        client: () => ({
          post: async () => {
            sent++;
            return {};
          },
        }),
      };
      yield* publishingBridge(
        config,
        {
          action: "confirm",
          campaignId: campaign.id,
          threadId: campaign.threadId,
          version: 1,
          draftId: "draft-cloud",
          revision: 1,
        },
        deps as never,
      ).pipe(Effect.flip);
      assert.strictEqual(sent, 0);
    }),
  );
  it.effect(
    "replays only an already-confirmed bound preview and resolves its saved media without caller file IDs",
    () =>
      Effect.gen(function* () {
        const campaign = {
          ...createCampaign("snapshot"),
          ownerKey: agentOwnerFromSession(session).key,
          threadId: "thread-snapshot",
          platforms: ["instagram"],
        };
        yield* saveDocument("campaign", campaign.id, campaign, null);
        yield* saveDocument(
          "social-draft-link",
          "draft-snapshot",
          {
            apiBaseUrl: session.apiBaseUrl,
            userId: session.userId,
            orgId: session.orgId,
            campaignId: campaign.id,
            campaignRevision: campaign.revision,
            draftId: "draft-snapshot",
            cloudRevision: 2,
            mediaFileId: "immutable-file",
            mediaMimeType: "image/jpeg",
          },
          null,
        );
        const paths: string[] = [];
        let revision = 2;
        const deps = {
          session: async () => session,
          client: () => ({
            get: async (path: string) => {
              paths.push(path);
              return path.startsWith("/v1/social/drafts/")
                ? {
                    id: "draft-snapshot",
                    confirmedAt: "2026-11-01T12:00:00Z",
                    threadId: campaign.threadId,
                    revision,
                    content: { mediaFileIds: ["immutable-file"] },
                  }
                : { url: "https://storage.test/signed" };
            },
            post: async (path: string, body: unknown) => {
              paths.push(path);
              assert.deepEqual(body, { revision: 2 });
              return { confirmed: true };
            },
          }),
        };
        const request = {
          campaignId: campaign.id,
          threadId: campaign.threadId,
          version: 1,
          draftId: "draft-snapshot",
          revision: 2,
        };
        const preview = yield* publishingBridge(
          config,
          { ...request, action: "preview-media", fileId: "foreign-file" },
          deps as never,
        );
        assert.deepEqual(preview, { url: "https://storage.test/signed", mimeType: "image/jpeg" });
        assert.include(paths, "/v1/files/immutable-file/url");
        assert.notInclude(paths, "/v1/files/foreign-file/url");
        yield* publishingBridge(config, { ...request, action: "confirm" }, deps as never);
        assert.include(paths, "/v1/social/drafts/draft-snapshot/confirm");
        revision = 3;
        const before = paths.filter((p) => p.includes("/v1/files/")).length;
        yield* publishingBridge(
          config,
          { ...request, action: "preview-media" },
          deps as never,
        ).pipe(Effect.flip);
        assert.strictEqual(paths.filter((p) => p.includes("/v1/files/")).length, before);
      }),
  );
  it.effect("rejects foreign and unbound legacy campaigns before cloud calls", () =>
    Effect.gen(function* () {
      let calls = 0;
      const deps = {
        session: async () => session,
        client: () => {
          calls++;
          throw new Error("Cloud must not be contacted");
        },
      };
      for (const ownerKey of ["foreign-owner", undefined]) {
        const campaign = {
          ...createCampaign("Denied"),
          threadId: "denied-publishing",
          ...(ownerKey ? { ownerKey } : {}),
        };
        yield* saveDocument("campaign", campaign.id, campaign, null);
        const error = yield* publishingBridge(
          config,
          { action: "state", campaignId: campaign.id, threadId: campaign.threadId },
          deps as never,
        ).pipe(Effect.flip);
        assert.include(String(error), "owner");
      }
      assert.strictEqual(calls, 0);
    }),
  );
  it.effect("rejects retired cloud preparation before reading bytes or requesting an upload", () =>
    Effect.gen(function* () {
      const assetId = crypto.randomUUID();
      const campaign = {
        ...createCampaign("Foreign selected media"),
        threadId: "foreign-media",
        ownerKey: agentOwnerFromSession(session).key,
        platforms: ["instagram"],
        assetIds: [assetId],
        captions: { instagram: "Preview" },
      };
      yield* saveDocument("campaign", campaign.id, campaign, null);
      yield* saveDocument(
        "asset",
        assetId,
        { id: assetId, mime: "image/png", ownerKey: "foreign-owner" },
        null,
      );
      let byteReads = 0,
        uploads = 0;
      const deps = {
        session: async () => session,
        readFile: async () => {
          byteReads++;
          return Buffer.alloc(0);
        },
        client: () => ({
          get: async () => ({
            accounts: [
              {
                id: "account",
                provider: "instagram",
                status: "connected",
                capabilities: { publish: true },
              },
            ],
          }),
          post: async () => {
            uploads++;
            return {};
          },
        }),
      };
      const error = yield* publishingBridge(
        config,
        {
          action: "prepare",
          campaignId: campaign.id,
          threadId: campaign.threadId,
          version: 1,
          accountIds: ["account"],
          publicationMode: "now",
          timezone: "UTC",
        },
        deps as never,
      ).pipe(Effect.flip);
      assert.include(String(error), "MultiPost");
      assert.strictEqual(byteReads, 0);
      assert.strictEqual(uploads, 0);
    }),
  );
  it.effect("pins cloud requests to the saved organization and forbids redirects/cookies", () =>
    Effect.promise(async () => {
      const client = createSocialCloudClient(
        session.apiBaseUrl,
        session.orgId,
        async (_url, init) => {
          assert.strictEqual(new Headers(init!.headers).get("x-org-id"), session.orgId);
          assert.strictEqual(init!.redirect, "error");
          assert.strictEqual(init!.credentials, "omit");
          return Response.json({ ok: true });
        },
      );
      await client.get("/v1/social/accounts", session.token);
    }),
  );
  it.effect(
    "routes new preparation to MultiPost without exchanging credentials or creating cloud work",
    () =>
      Effect.gen(function* () {
        const campaign = { ...createCampaign("Migration"), threadId: "migration-chat" };
        yield* saveDocument("campaign", campaign.id, campaign, null);
        let credentialsRead = false;
        const failure = yield* publishingBridge(
          config,
          { action: "prepare", campaignId: campaign.id, threadId: campaign.threadId, version: 1 },
          {
            session: async () => {
              credentialsRead = true;
              return session;
            },
          } as never,
        ).pipe(Effect.flip);
        assert.include(failure.message, "MultiPost");
        assert.isFalse(credentialsRead);
      }),
  );
});
