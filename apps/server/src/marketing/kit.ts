import { Effect } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import JSZip from "jszip";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  defaultImageRecipe,
  platforms,
  type Campaign,
  type MediaAsset,
  type ImageRecipe,
} from "@synara/contracts";
import { readDocument, MarketingError } from "./store";
import { renderImage } from "./media";
export function publishingKit(stateDir: string, id: string, revision: number) {
  return Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const snapshot = yield* sql.withTransaction(
      Effect.gen(function* () {
        const record = yield* readDocument("campaign", id);
        const campaign = record?.value as Campaign | undefined;
        if (!campaign || campaign.revision !== revision || campaign.approvedRevision !== revision)
          return yield* Effect.fail(
            new MarketingError("Review and approve the latest version before downloading.", 409),
          );
        const assets: { asset: MediaAsset; recipe: ImageRecipe }[] = [];
        let bytes = 0;
        for (const assetId of campaign.assetIds) {
          const saved = yield* readDocument("asset", assetId);
          if (!saved)
            return yield* Effect.fail(new MarketingError("A campaign file is missing.", 404));
          const asset = saved.value as MediaAsset;
          bytes += asset.bytes;
          const recipe = yield* readDocument("recipe", assetId);
          assets.push({
            asset,
            recipe: recipe ? (recipe.value as { recipe: ImageRecipe }).recipe : defaultImageRecipe,
          });
        }
        if (bytes > 256 * 1024 * 1024)
          return yield* Effect.fail(
            new MarketingError(
              "This campaign is too large for a single publishing kit. Download its media individually.",
            ),
          );
        return { campaign, assets };
      }),
    );
    return yield* Effect.tryPromise({
      try: async () => {
        const zip = new JSZip();
        zip.file(
          "campaign.json",
          JSON.stringify(
            {
              name: snapshot.campaign.name,
              revision,
              platforms: snapshot.campaign.platforms,
              captions: snapshot.campaign.captions,
            },
            null,
            2,
          ),
        );
        for (const platform of snapshot.campaign.platforms)
          zip.file(`captions/${platform}.txt`, snapshot.campaign.captions[platform] ?? "");
        for (const { asset, recipe } of snapshot.assets) {
          const bytes = await readFile(path.join(stateDir, "marketing", "originals", asset.id));
          const image = asset.mime.startsWith("image/");
          zip.file(
            `media/${asset.id}.${image ? "png" : asset.mime === "video/webm" ? "webm" : "mp4"}`,
            image ? await renderImage(bytes, recipe) : bytes,
          );
        }
        zip.file(
          "READ-ME.txt",
          `Campaign: ${snapshot.campaign.name}\nApproved revision: ${revision}\n\nThis kit has NOT been published. Upload the media and use the matching caption on each selected platform. Check the destination's media limits and preview before posting.\n\n${snapshot.campaign.platforms
            .map((id) => {
              const p = platforms.find((p) => p.id === id);
              return `${p?.name}: ${p?.url}`;
            })
            .join(
              "\n",
            )}\n\nWhatsApp: use only consented business recipients; this is not Status publishing.\n`,
        );
        return zip.generateAsync({ type: "uint8array", compression: "STORE" });
      },
      catch: () =>
        new MarketingError(
          "Could not prepare the publishing kit. Check that all media is available.",
        ),
    });
  });
}
