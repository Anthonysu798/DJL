import { it, assert } from "@effect/vitest";
import { Effect } from "effect";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite";
import { executeMarketingTool } from "./chatTools";
import { readDocument } from "./store";
import type { Campaign } from "@synara/contracts";
const scope = {
  threadId: "thread-one",
  authorizedRoot: "/tmp",
  attachmentFiles: [],
  stateDir: "/tmp/marketing-tool-test",
};
it.layer(SqlitePersistenceMemory)("chat marketing tools", (it) => {
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
