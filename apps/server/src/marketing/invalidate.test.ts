import { it, assert } from "@effect/vitest";
import { Effect } from "effect";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite";
import {
  createCampaign,
  reviseCampaign,
  approveCampaign,
  defaultImageRecipe,
  type Campaign,
} from "@synara/contracts";
import { saveDocument, readDocument } from "./store";
import { saveImageRecipe, saveVideoTimeline } from "./revisions";
it.layer(SqlitePersistenceMemory)("media revision approvals", (it) => {
  it.effect("invalidates approvals when an image changes and keeps durable image history", () =>
    Effect.gen(function* () {
      const c = reviseCampaign(createCampaign("Launch"), {
        assetIds: ["image"],
        platforms: ["instagram"],
        captions: { instagram: "Launch" },
      });
      yield* saveDocument("campaign", c.id, approveCampaign(c, c.revision), null);
      yield* saveImageRecipe("image", { ...defaultImageRecipe, exposure: 1 }, null);
      const changed = (yield* readDocument("campaign", c.id))!.value as Campaign;
      assert.strictEqual(changed.approvedRevision, null);
      assert.strictEqual(changed.revision, c.revision + 1);
      yield* saveImageRecipe("image", { ...defaultImageRecipe, exposure: 2 }, 1);
      const recipe = (yield* readDocument("recipe", "image"))!.value as { history: unknown[] };
      assert.lengthOf(recipe.history, 2);
    }),
  );
  it.effect("invalidates approved revisions transactionally when a timeline changes", () =>
    Effect.gen(function* () {
      const c = reviseCampaign(createCampaign("Video launch"), {
        assetIds: ["video"],
        platforms: ["youtube"],
        captions: { youtube: "Launch" },
      });
      yield* saveDocument("campaign", c.id, approveCampaign(c, c.revision), null);
      yield* saveVideoTimeline(c.id, { campaignId: c.id, clips: [] }, null);
      const updated = (yield* readDocument("campaign", c.id))!.value as Campaign;
      assert.strictEqual(updated.approvedRevision, null);
      assert.strictEqual(updated.revision, c.revision + 1);
    }),
  );
});
