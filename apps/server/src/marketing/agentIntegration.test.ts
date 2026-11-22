import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { it, assert } from "@effect/vitest";
import { Effect } from "effect";
import { defaultBrand } from "@djl/contracts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite";
import { writeCloudSession } from "../cloud/session";
import { executeAgentRequest } from "./agentHandler";
import { executeMarketingTool, MARKETING_TOOLS } from "./chatTools";
import { readDocument } from "./store";

const session = {
  apiBaseUrl: "https://example.com",
  token: "fixture-only",
  userId: "user-a",
  orgId: "org-a",
  email: "test@example.com",
  createdAt: "2026-10-26T00:00:00Z",
};
it.layer(SqlitePersistenceMemory)("social agent integration", (it) => {
  it.effect(
    "prepares owner-scoped drafts and never exposes another account's campaign or brand",
    () =>
      Effect.gen(function* () {
        const root = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "djl-agent-integration-")));
        const scope = {
          threadId: "shared-local-thread",
          authorizedRoot: root,
          attachmentFiles: [],
          stateDir: root,
          secretsDir: root + "/secrets",
        };
        try {
          yield* Effect.promise(() => writeCloudSession(scope.secretsDir, session));
          yield* executeMarketingTool(scope, "djl_brand_memory", {
            action: "save",
            version: null,
            profile: { ...defaultBrand, name: "Owned brand", facts: "No invented discounts" },
          });
          const prepared = yield* executeMarketingTool(scope, "djl_prepare_marketing", {
            name: "Owned campaign",
            platforms: ["instagram"],
            captions: { instagram: "Grounded caption" },
          });
          const saved = yield* readDocument("campaign", String(prepared.campaignId));
          assert.isString((saved!.value as { ownerKey: string }).ownerKey);
          const state = yield* executeMarketingTool(scope, "djl_marketing_status", {});
          assert.strictEqual((state.brand as { name: string }).name, "Owned brand");
          assert.strictEqual(JSON.stringify(state).includes("fixture-only"), false);
          yield* Effect.promise(() =>
            writeCloudSession(scope.secretsDir, { ...session, userId: "user-b" }),
          );
          const foreign = yield* executeMarketingTool(scope, "djl_marketing_status", {});
          assert.deepEqual(foreign.campaigns, []);
          assert.strictEqual((foreign.brand as { name: string }).name, "");
          const denied = yield* executeMarketingTool(scope, "djl_prepare_marketing", {
            campaignId: prepared.campaignId,
            version: prepared.version,
            name: "Attempt",
            platforms: ["instagram"],
            captions: { instagram: "Must not change" },
          }).pipe(Effect.result);
          assert.strictEqual(denied._tag, "Failure");
          assert.strictEqual(
            (yield* readDocument("campaign", String(prepared.campaignId)))!.version,
            saved!.version,
          );
        } finally {
          yield* Effect.promise(() => rm(root, { recursive: true, force: true }));
        }
      }),
  );
  it.effect("direct UI requests reject model-supplied identity and publication tools", () =>
    Effect.gen(function* () {
      const config = {
        stateDir: join(tmpdir(), "missing-agent-session"),
        secretsDir: join(tmpdir(), "missing-agent-session/secrets"),
        cwd: tmpdir(),
      };
      for (const raw of [
        { threadId: "chat", tool: "djl_brand_memory", args: { action: "read" }, userId: "spoofed" },
        { threadId: "chat", tool: "djl_confirm_social_publish", args: {} },
        { threadId: "", tool: "djl_brand_memory", args: {} },
        {
          threadId: "chat",
          tool: "djl_brand_memory",
          args: { action: "read", ownerKey: "spoofed" },
        },
      ])
        assert.strictEqual(
          (yield* executeAgentRequest(config, raw).pipe(Effect.result))._tag,
          "Failure",
        );
    }),
  );
  it.effect(
    "all seven capability tool families are available without an agent publish-confirm tool",
    () =>
      Effect.sync(() => {
        const names = MARKETING_TOOLS.map((tool) => tool.name);
        for (const name of [
          "djl_import_product_url",
          "djl_social_workflows",
          "djl_repurpose_video",
          "djl_transcribe_video",
          "djl_media_library",
          "djl_brand_memory",
          "djl_social_coach",
          "djl_social_inbox",
        ])
          assert.include(names, name);
        assert.strictEqual(
          names.some((name) => /confirm.*publish|publish.*confirm/.test(name)),
          false,
        );
      }),
  );
});
