import { Effect } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import {
  defaultImageRecipe,
  reviseCampaign,
  type Campaign,
  type ImageRecipe,
} from "@synara/contracts";
import { listDocuments, readDocument, saveDocument } from "./store";
export function saveImageRecipe(id: string, recipe: ImageRecipe, version: number | null) {
  return Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    return yield* sql.withTransaction(
      Effect.gen(function* () {
        const previous = yield* readDocument("recipe", id);
        const prior = previous?.value as
          | { recipe: ImageRecipe; history: ImageRecipe[] }
          | undefined;
        const saved = yield* saveDocument(
          "recipe",
          id,
          {
            id,
            recipe,
            history: [...(prior?.history ?? []), prior?.recipe ?? defaultImageRecipe].slice(-100),
          },
          version,
        );
        const campaigns = yield* listDocuments("campaign");
        for (const record of campaigns) {
          const c = record.value as Campaign;
          if (c.assetIds.includes(id))
            yield* saveDocument("campaign", c.id, reviseCampaign(c, {}), record.version);
        }
        return saved;
      }),
    );
  });
}
export function saveVideoTimeline(id: string, timeline: unknown, version: number | null) {
  return Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    return yield* sql.withTransaction(
      Effect.gen(function* () {
        const saved = yield* saveDocument("timeline", id, timeline, version);
        const campaign = yield* readDocument("campaign", id);
        if (campaign)
          yield* saveDocument(
            "campaign",
            id,
            reviseCampaign(campaign.value as Campaign, {}),
            campaign.version,
          );
        return saved;
      }),
    );
  });
}
