import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import sharp from "sharp";
import { it, assert } from "@effect/vitest";
import { Effect } from "effect";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite";
import { executeMarketingTool } from "./chatTools";
import { readDocument } from "./store";
import type { Campaign } from "@djl/contracts";
const scope = {
  threadId: "thread-one",
  authorizedRoot: "/tmp",
  attachmentFiles: [],
  stateDir: "/tmp/marketing-tool-test",
};
it.layer(SqlitePersistenceMemory)("chat marketing tools", (it) => {
  it.effect(
    "replaces media without accumulating old files and preserves the replacement on copy-only edits",
    () =>
      Effect.gen(function* () {
        const root = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "djl-media-replace-")));
        try {
          const a = root + "/a.png",
            b = root + "/b.png";
          yield* Effect.promise(async () => {
            await writeFile(
              a,
              await sharp({ create: { width: 10, height: 10, channels: 3, background: "red" } })
                .png()
                .toBuffer(),
            );
            await writeFile(
              b,
              await sharp({ create: { width: 10, height: 10, channels: 3, background: "blue" } })
                .png()
                .toBuffer(),
            );
          });
          const context = {
            ...scope,
            threadId: "replace-media",
            authorizedRoot: root,
            stateDir: root,
            attachmentFiles: [a],
          };
          const first = yield* executeMarketingTool(context, "djl_prepare_marketing", {
            name: "Post",
            platforms: ["instagram"],
            captions: { instagram: "Original" },
          });
          const before = yield* readDocument("campaign", String(first.campaignId));
          const next = yield* executeMarketingTool(
            { ...context, attachmentFiles: [a, b] },
            "djl_prepare_marketing",
            {
              campaignId: first.campaignId,
              version: first.version,
              name: "Post",
              platforms: ["instagram"],
              captions: { instagram: "Replacement" },
              replaceMedia: true,
              mediaPaths: ["Attachments/b.png"],
            },
          );
          const replaced = yield* readDocument("campaign", String(first.campaignId));
          assert.lengthOf((replaced!.value as Campaign).assetIds, 1);
          assert.notDeepEqual(
            (replaced!.value as Campaign).assetIds,
            (before!.value as Campaign).assetIds,
          );
          yield* executeMarketingTool(
            { ...context, attachmentFiles: [a, b] },
            "djl_prepare_marketing",
            {
              campaignId: first.campaignId,
              version: next.version,
              name: "Post",
              platforms: ["instagram"],
              captions: { instagram: "Lighter tone" },
            },
          );
          const edited = yield* readDocument("campaign", String(first.campaignId));
          assert.deepEqual(
            (edited!.value as Campaign).assetIds,
            (replaced!.value as Campaign).assetIds,
          );
        } finally {
          yield* Effect.promise(() => rm(root, { recursive: true, force: true }));
        }
      }),
  );

  it.effect("creates a chat-owned draft without approving or publishing it", () =>
    Effect.gen(function* () {
      const result = yield* executeMarketingTool(scope, "djl_prepare_marketing", {
        name: "Launch",
        brief: "Promote the room",
        platforms: ["instagram", "red"],
        captions: { instagram: "Welcome", red: "欢迎" },
      });
      const record = yield* readDocument("campaign", String(result.campaignId));
      const c = record!.value as Campaign;
      assert.strictEqual(c.threadId, scope.threadId);
      assert.strictEqual(c.approvedRevision, null);
      assert.deepStrictEqual(c.publications, {});
      const foreign = yield* executeMarketingTool(
        { ...scope, threadId: "other" },
        "djl_prepare_marketing",
        {
          campaignId: c.id,
          version: 1,
          name: "Stolen",
          platforms: ["instagram"],
          captions: { instagram: "No" },
        },
      ).pipe(Effect.flip);
      assert.include(String(foreign), "conversation");
    }),
  );
  it.effect("requires the current version before updating an existing conversation campaign", () =>
    Effect.gen(function* () {
      const a = yield* executeMarketingTool(
        { ...scope, threadId: "thread-two" },
        "djl_prepare_marketing",
        { name: "Draft", platforms: ["instagram"], captions: { instagram: "One" } },
      );
      const fail = yield* executeMarketingTool(
        { ...scope, threadId: "thread-two" },
        "djl_prepare_marketing",
        {
          campaignId: a.campaignId,
          version: 0,
          name: "Changed",
          platforms: ["instagram"],
          captions: { instagram: "Two" },
        },
      ).pipe(Effect.flip);
      assert.include(String(fail), "changed");
    }),
  );
});
