import { renderImage } from "../marketing/media";
import type { ImageRecipe } from "@synara/contracts";
import { readFile } from "node:fs/promises";
import { Effect } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { mkdir, copyFile, writeFile, realpath, stat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type {
  Campaign,
  MediaAsset,
  MultiPostCommand,
  MultiPostContentData,
  MultiPostScope,
  MultiPostState,
} from "@synara/contracts";
import type { ServerConfigShape } from "../config";
import { assertAgentCampaignAccess, assertAgentMediaAccess } from "../marketing/agentScope";
import { readDocument, MarketingError } from "../marketing/store";
import { getMultiPost } from "./live";
export function importLegacyCampaign(
  config: Pick<ServerConfigShape, "stateDir" | "secretsDir">,
  scope: MultiPostScope,
  input: Extract<MultiPostCommand, { action: "import-campaign" }>,
) {
  return Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const record = yield* readDocument("campaign", input.campaignId);
    const campaign = record?.value as Campaign | undefined;
    if (!campaign || campaign.threadId !== scope.threadId || record?.version !== input.version)
      return yield* Effect.fail(
        new MarketingError("Campaign changed or belongs to another conversation.", 409),
      );
    const ownershipScope = { ...scope, ...config, attachmentFiles: [] };
    yield* assertAgentCampaignAccess(ownershipScope, campaign);
    const recipes = new Map<string, ImageRecipe>();
    const assets: MediaAsset[] = [];
    for (const id of campaign.assetIds) {
      const saved = yield* readDocument("asset", id);
      if (!saved) return yield* Effect.fail(new MarketingError("Campaign media is missing."));
      yield* assertAgentMediaAccess(ownershipScope, saved.value);
      assets.push(saved.value as MediaAsset);
      const recipe = yield* readDocument("recipe", id);
      if (recipe) recipes.set(id, (recipe.value as { recipe: ImageRecipe }).recipe);
    }
    return yield* Effect.tryPromise({
      try: async () => {
        const { service } = await getMultiPost(sql);
        const state = (await service.command(
          scope,
          { action: "state" },
          "agent",
        )) as MultiPostState;
        const ids = input.accountIds ?? [];
        const accounts = state.accounts.filter((x) =>
          ids.length
            ? ids.includes(x.id)
            : campaign.platforms.includes(
                ({ rednote: "red", weixinchannel: "wechat" } as Record<string, string>)[
                  x.platformKey
                ] ?? x.platformKey,
              ),
        );
        const kind = assets.some((x) => x.mime.startsWith("video/"))
          ? "video"
          : assets.some((x) => x.mime.startsWith("audio/"))
            ? "podcast"
            : "dynamic";
        const targets = accounts.flatMap((account) => {
          const adapter = state.capabilities.find(
            (x) => x.platformKey === account.platformKey && x.kind === kind,
          );
          const platform =
            ({ rednote: "red", weixinchannel: "wechat" } as Record<string, string>)[
              account.platformKey
            ] ?? account.platformKey;
          return adapter
            ? [
                {
                  accountId: account.id,
                  adapterId: adapter.id,
                  overrides: { content: campaign.captions[platform] ?? "" },
                },
              ]
            : [];
        });
        if (!targets.length)
          throw new Error(
            "Connect and choose MultiPost account profiles before importing. Cloud OAuth identities are not copied.",
          );
        if (!scope.mediaRoot) throw new Error("Local media storage is unavailable");
        await mkdir(scope.mediaRoot, { recursive: true, mode: 0o700 });
        const files = [];
        if (assets.length) {
          const original = await realpath(path.join(config.stateDir, "marketing/originals"));
          for (const asset of assets) {
            const source = await realpath(path.join(original, asset.id));
            if (!source.startsWith(original + path.sep))
              throw new Error("Campaign media is outside its authorized library");
            const id = randomUUID();
            const recipe = asset.mime.startsWith("image/") ? recipes.get(asset.id) : undefined;
            if (recipe && asset.mime.startsWith("image/"))
              await writeFile(
                path.join(scope.mediaRoot, id),
                await renderImage(await readFile(source), recipe),
                { mode: 0o600 },
              );
            else await copyFile(source, path.join(scope.mediaRoot, id));
            const size = (await stat(path.join(scope.mediaRoot, id))).size;
            const name = recipe ? `${path.parse(asset.name).name}.png` : asset.name;
            const type = recipe ? "image/png" : asset.mime;
            await writeFile(
              path.join(scope.mediaRoot, id + ".json"),
              JSON.stringify({ name, type, size }),
              { mode: 0o600 },
            );
            files.push({ name, type, url: `Media/${id}`, size });
          }
        }
        const data: MultiPostContentData = {
          title: campaign.name,
          content: Object.values(campaign.captions)[0] ?? campaign.brief,
          images: files.filter((x) => x.type.startsWith("image/")),
          ...(kind === "video" ? { video: files.find((x) => x.type.startsWith("video/"))! } : {}),
          ...(kind === "podcast"
            ? {
                audio: files.find((x) => x.type.startsWith("audio/"))!,
                description: Object.values(campaign.captions)[0] ?? campaign.brief,
              }
            : {}),
        };
        return service.command(
          scope,
          {
            action: "save-draft",
            draft: {
              kind,
              data,
              targets,
              publicationMode: input.publicationMode ?? "now",
              scheduledAt: input.scheduledAt ?? null,
              timezone: input.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
            },
          },
          "agent",
        );
      },
      catch: (error) =>
        new MarketingError(error instanceof Error ? error.message : "Could not import campaign"),
    });
  });
}
