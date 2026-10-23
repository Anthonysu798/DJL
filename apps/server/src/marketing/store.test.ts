import { it, assert } from "@effect/vitest";
import { Effect } from "effect";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite";
import { createCampaign } from "@synara/contracts";
import { readDocument, saveDocument } from "./store";

it.layer(SqlitePersistenceMemory)("marketing persistence", (it) => {
  it.effect("persists campaigns and refuses stale writes without losing saved content", () =>
    Effect.gen(function* () {
      const campaign = createCampaign("Launch");
      yield* saveDocument("campaign", campaign.id, campaign, null);
      assert.deepStrictEqual(yield* readDocument("campaign", campaign.id), {
        value: campaign,
        version: 1,
      });
      yield* saveDocument("campaign", campaign.id, { ...campaign, name: "New" }, 1);
      const stale = yield* saveDocument("campaign", campaign.id, campaign, 1).pipe(Effect.flip);
      assert.include(String(stale), "changed");
      const saved = yield* readDocument("campaign", campaign.id);
      assert.strictEqual((saved!.value as typeof campaign).name, "New");
    }),
  );
});
