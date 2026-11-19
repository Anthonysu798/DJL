import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import sharp from "sharp";
import { vi } from "vitest";
import * as productSource from "./productSource";
import { it, assert } from "@effect/vitest";
import { Effect } from "effect";
import { defaultBrand, createCampaign } from "@synara/contracts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite";
import { writeCloudSession } from "../cloud/session";
import { executeSourceTool, authorizeLibraryAssets, readAgentBrand } from "./sourceTools";
import { resolveAgentOwner } from "./agentScope";
import { saveDocument, readDocument } from "./store";

it.layer(SqlitePersistenceMemory)("owned source workspace", (it) => {
  it.effect("persists brand memory and refuses stale versions and cross-owner bodies", () =>
    Effect.gen(function* () {
      const root = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "djl-brand-")));
      const scope = {
        threadId: "brand",
        authorizedRoot: root,
        stateDir: root,
        attachmentFiles: [],
      };
      try {
        yield* Effect.promise(() =>
          writeCloudSession(root + "/secrets", {
            apiBaseUrl: "https://api.djl.ai",
            token: "fixture",
            email: "fixture@example.com",
            userId: "one",
            orgId: "org",
            createdAt: new Date().toISOString(),
          }),
        );
        assert.strictEqual((yield* readAgentBrand(scope)).version, null);
        const profile = {
          ...defaultBrand,
          name: "Acme",
          facts: "Founded in 2001",
          prohibitedClaims: "No invented discounts",
        };
        const first = yield* executeSourceTool(scope, "djl_brand_memory", {
          action: "save",
          version: null,
          profile,
        });
        assert.strictEqual(first.version, 1);
        assert.deepEqual((yield* readAgentBrand(scope)).profile, profile);
        const stale = yield* executeSourceTool(scope, "djl_brand_memory", {
          action: "save",
          version: 0,
          profile,
        }).pipe(Effect.flip);
        assert.include(String(stale), "changed");
        const owner = yield* resolveAgentOwner(scope);
        const stored = yield* readDocument("brand", `agent:${owner.key}`);
        yield* saveDocument(
          "brand",
          `agent:${owner.key}`,
          { ownerKey: "foreign", profile },
          stored!.version,
        );
        assert.include(String(yield* readAgentBrand(scope).pipe(Effect.flip)), "another");
      } finally {
        yield* Effect.promise(() => rm(root, { recursive: true, force: true }));
      }
    }),
  );
  it.effect(
    "indexes only current owned campaign media, persists evidence search and authorizes same-owner reuse",
    () =>
      Effect.gen(function* () {
        const root = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "djl-library-")));
        const scope = {
          threadId: "library",
          authorizedRoot: root,
          stateDir: root,
          attachmentFiles: [],
        };
        try {
          const session = {
            apiBaseUrl: "https://api.djl.ai",
            token: "fixture",
            email: "fixture@example.com",
            userId: "one",
            orgId: "org",
            createdAt: new Date().toISOString(),
          };
          yield* Effect.promise(() => writeCloudSession(root + "/secrets", session));
          const owner = yield* resolveAgentOwner(scope);
          yield* saveDocument(
            "asset",
            "library-asset",
            {
              id: "library-asset",
              name: "boring.mp4",
              mime: "video/mp4",
              bytes: 40,
              createdAt: new Date().toISOString(),
            },
            null,
          );
          yield* saveDocument(
            "campaign",
            "library-campaign",
            {
              ...createCampaign("Owned"),
              id: "library-campaign",
              threadId: scope.threadId,
              ownerKey: owner.key,
              assetIds: ["library-asset"],
            },
            null,
          );
          const indexed = yield* executeSourceTool(scope, "djl_media_library", {
            action: "index",
            assetIds: ["library-asset"],
            description: "Red lamp on a wooden desk",
            tags: ["interior"],
            transcript: "Warm light for evening reading",
            version: null,
          });
          assert.deepEqual(indexed.assetIds, ["library-asset"]);
          const result = yield* executeSourceTool(
            { ...scope, threadId: "second-chat" },
            "djl_media_library",
            { action: "search", query: "evening" },
          );
          assert.lengthOf(result.items as unknown[], 1);
          const allTerms = yield* executeSourceTool(scope, "djl_media_library", {
            action: "search",
            query: "lamp interior",
          });
          assert.lengthOf(allTerms.items as unknown[], 1);
          assert.lengthOf(
            yield* authorizeLibraryAssets({ ...scope, threadId: "second-chat" }, ["library-asset"]),
            1,
          );
          const assetRecord = yield* readDocument("asset", "library-asset");
          yield* saveDocument(
            "asset",
            "library-asset",
            { ...(assetRecord!.value as object), ownerKey: "foreign-owner" },
            assetRecord!.version,
          );
          assert.include(
            String(yield* authorizeLibraryAssets(scope, ["library-asset"]).pipe(Effect.flip)),
            "unavailable",
          );
          yield* saveDocument(
            "asset",
            "library-asset",
            { ...(assetRecord!.value as object), ownerKey: owner.key },
            assetRecord!.version + 1,
          );
          const stale = yield* executeSourceTool(scope, "djl_media_library", {
            action: "index",
            assetIds: ["library-asset"],
            description: "Edited",
            version: 0,
          }).pipe(Effect.flip);
          assert.include(String(stale), "changed");
          assert.include(
            String(
              yield* executeSourceTool(scope, "djl_media_library", {
                action: "index",
                assetIds: ["unknown"],
                description: "Injected",
              }).pipe(Effect.flip),
            ),
            "owned",
          );
          yield* Effect.promise(() =>
            writeCloudSession(root + "/secrets", { ...session, userId: "two" }),
          );
          const foreign = yield* executeSourceTool(scope, "djl_media_library", { action: "list" });
          assert.deepEqual(foreign.items, []);
          assert.include(
            String(yield* authorizeLibraryAssets(scope, ["library-asset"]).pipe(Effect.flip)),
            "owned",
          );
          assert.include(
            String(
              yield* executeSourceTool(scope, "djl_media_library", {
                action: "index",
                assetIds: ["library-asset"],
                description: "Theft",
              }).pipe(Effect.flip),
            ),
            "owned",
          );
        } finally {
          yield* Effect.promise(() => rm(root, { recursive: true, force: true }));
        }
      }),
  );
  it.effect("indexes verified legacy campaign media while denying unbound and foreign owners", () =>
    Effect.gen(function* () {
      const root = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "djl-legacy-library-")));
      const scope = {
        threadId: "legacy-library",
        authorizedRoot: root,
        stateDir: root,
        attachmentFiles: [],
      };
      try {
        const session = {
          apiBaseUrl: "https://api.djl.ai",
          token: "fixture",
          email: "fixture@example.com",
          userId: "legacy-one",
          orgId: "org",
          createdAt: new Date().toISOString(),
        };
        yield* Effect.promise(() => writeCloudSession(root + "/secrets", session));
        const owner = yield* resolveAgentOwner(scope);
        const assetId = crypto.randomUUID();
        const campaign = {
          ...createCampaign("Published legacy"),
          threadId: scope.threadId,
          assetIds: [assetId],
        };
        yield* saveDocument(
          "asset",
          assetId,
          {
            id: assetId,
            name: "published.png",
            mime: "image/png",
            bytes: 20,
            createdAt: new Date().toISOString(),
          },
          null,
        );
        yield* saveDocument("campaign", campaign.id, campaign, null);
        const args = {
          action: "index",
          assetIds: [assetId],
          description: "Existing published room image",
          tags: ["room"],
          version: null,
        };
        assert.include(
          String(yield* executeSourceTool(scope, "djl_media_library", args).pipe(Effect.flip)),
          "owned",
        );
        const bindingId = crypto.randomUUID();
        const binding = {
          campaignId: campaign.id,
          apiBaseUrl: "https://other-cloud.example",
          userId: session.userId,
          orgId: session.orgId,
        };
        yield* saveDocument("social-draft-link", bindingId, binding, null);
        assert.include(
          String(yield* executeSourceTool(scope, "djl_media_library", args).pipe(Effect.flip)),
          "owned",
        );
        yield* saveDocument(
          "social-draft-link",
          bindingId,
          { ...binding, apiBaseUrl: session.apiBaseUrl },
          1,
        );
        const indexed = yield* executeSourceTool(scope, "djl_media_library", args);
        assert.deepEqual(indexed.assetIds, [assetId]);
        const saved = yield* readDocument("agent-media", `${owner.key}:${assetId}`);
        assert.strictEqual((saved!.value as { ownerKey: string }).ownerKey, owner.key);
        yield* saveDocument("campaign", campaign.id, { ...campaign, assetIds: [] }, 1);
        assert.strictEqual(
          (yield* authorizeLibraryAssets({ ...scope, threadId: "later" }, [assetId]))[0]!.id,
          assetId,
        );
        const foreignAssetId = crypto.randomUUID();
        const foreignCampaign = {
          ...createCampaign("Foreign"),
          threadId: scope.threadId,
          ownerKey: "foreign-owner",
          assetIds: [foreignAssetId],
        };
        yield* saveDocument(
          "asset",
          foreignAssetId,
          { id: foreignAssetId, mime: "image/png" },
          null,
        );
        yield* saveDocument("campaign", foreignCampaign.id, foreignCampaign, null);
        yield* saveDocument(
          "social-draft-link",
          crypto.randomUUID(),
          {
            campaignId: foreignCampaign.id,
            apiBaseUrl: session.apiBaseUrl,
            userId: session.userId,
            orgId: session.orgId,
          },
          null,
        );
        assert.include(
          String(
            yield* executeSourceTool(scope, "djl_media_library", {
              ...args,
              assetIds: [foreignAssetId],
            }).pipe(Effect.flip),
          ),
          "owned",
        );
      } finally {
        yield* Effect.promise(() => rm(root, { recursive: true, force: true }));
      }
    }),
  );
  it.effect(
    "imports a decoded product image into the owned reusable library with persisted provenance",
    () =>
      Effect.gen(function* () {
        const root = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "djl-product-import-")));
        const scope = {
          threadId: "product-import",
          authorizedRoot: root,
          stateDir: root,
          attachmentFiles: [],
        };
        const bytes = yield* Effect.promise(() =>
          sharp({ create: { width: 20, height: 10, channels: 3, background: "red" } })
            .png()
            .toBuffer(),
        );
        const fetch = vi.spyOn(productSource, "fetchPublicResource");
        fetch.mockResolvedValueOnce({
          status: 200,
          location: undefined,
          contentType: "text/html",
          bytes: Buffer.from(
            '<meta property="og:title" content="Red lamp"><meta property="og:image" content="https://example.com/lamp.png">',
          ),
          sourceUrl: "https://example.com/product",
        });
        fetch.mockResolvedValueOnce({
          status: 200,
          location: undefined,
          contentType: "image/png",
          bytes,
          sourceUrl: "https://example.com/lamp.png",
        });
        try {
          yield* Effect.promise(() =>
            writeCloudSession(root + "/secrets", {
              apiBaseUrl: "https://api.djl.ai",
              token: "fixture",
              email: "fixture@example.com",
              userId: "one",
              orgId: "org",
              createdAt: new Date().toISOString(),
            }),
          );
          const imported = yield* executeSourceTool(scope, "djl_import_product_url", {
            url: "https://example.com/product",
          });
          assert.lengthOf(imported.assetIds as string[], 1);
          const id = (imported.assetIds as string[])[0]!;
          assert.match(id, /^[a-f0-9-]{36}$/);
          const original = yield* Effect.promise(() =>
            readFile(root + "/marketing/originals/" + id),
          );
          assert.deepEqual(original, bytes);
          const reused = yield* authorizeLibraryAssets({ ...scope, threadId: "later" }, [id]);
          assert.strictEqual(reused[0]!.width, 20);
          const product = imported.product as { id: string; sourceUrl: string };
          const stored = yield* readDocument("agent-product", product.id);
          assert.strictEqual(
            (stored!.value as { sourceUrl: string }).sourceUrl,
            "https://example.com/product",
          );
          const owner = yield* resolveAgentOwner(scope);
          assert.strictEqual((stored!.value as { ownerKey: string }).ownerKey, owner.key);
          const assetRecord = yield* readDocument("asset", id);
          assert.strictEqual((assetRecord!.value as { ownerKey: string }).ownerKey, owner.key);
          const reopened = yield* executeSourceTool(
            { ...scope, threadId: "later" },
            "djl_media_library",
            { action: "list" },
          );
          assert.strictEqual((reopened.products as { title: string }[])[0]!.title, "Red lamp");
        } finally {
          fetch.mockRestore();
          yield* Effect.promise(() => rm(root, { recursive: true, force: true }));
        }
      }),
  );
  it.effect("keeps sourced facts and reports image failure without creating a fake asset", () =>
    Effect.gen(function* () {
      const root = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "djl-product-failure-")));
      const scope = {
        threadId: "product-failure",
        authorizedRoot: root,
        stateDir: root,
        attachmentFiles: [],
      };
      const fetch = vi.spyOn(productSource, "fetchPublicResource");
      fetch.mockResolvedValueOnce({
        status: 200,
        location: undefined,
        contentType: "text/html",
        bytes: Buffer.from(
          '<title>Lamp</title><meta property="og:image" content="https://example.com/not-an-image">',
        ),
        sourceUrl: "https://example.com/product",
      });
      fetch.mockResolvedValueOnce({
        status: 200,
        location: undefined,
        contentType: "image/png",
        bytes: Buffer.from("this is HTML"),
        sourceUrl: "https://example.com/not-an-image",
      });
      try {
        yield* Effect.promise(() =>
          writeCloudSession(root + "/secrets", {
            apiBaseUrl: "https://api.djl.ai",
            token: "fixture",
            email: "fixture@example.com",
            userId: "one",
            orgId: "org",
            createdAt: new Date().toISOString(),
          }),
        );
        const imported = yield* executeSourceTool(scope, "djl_import_product_url", {
          url: "https://example.com/product",
        });
        assert.deepEqual(imported.assetIds, []);
        assert.include(String(imported.imageWarning), "not imported");
        assert.strictEqual((imported.product as { title: string }).title, "Lamp");
      } finally {
        fetch.mockRestore();
        yield* Effect.promise(() => rm(root, { recursive: true, force: true }));
      }
    }),
  );
  it.effect("requires sign-in and rejects caller-supplied ownership", () =>
    Effect.gen(function* () {
      const scope = {
        threadId: "empty",
        authorizedRoot: tmpdir(),
        stateDir: join(tmpdir(), "djl-no-session-sources"),
        attachmentFiles: [],
      };
      assert.include(String(yield* readAgentBrand(scope).pipe(Effect.flip)), "Sign in");
      assert.include(
        String(
          yield* executeSourceTool(scope, "djl_media_library", {
            action: "list",
            ownerKey: "fake",
          }).pipe(Effect.flip),
        ),
        "Invalid",
      );
    }),
  );
});
