import { it, assert } from "@effect/vitest";
import { Effect } from "effect";
import { createCampaign } from "@djl/contracts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite";
import { MarketingError, saveDocument } from "./store";
import { executeCampaignLinkTool } from "./campaignLinkTools";

const owner = { key: "owner-a", userId: "a", orgId: "org-a", apiBaseUrl: "https://api.example" };
const scope = { threadId: "chat", authorizedRoot: "/tmp", attachmentFiles: [], stateDir: "/tmp" };
it.layer(SqlitePersistenceMemory)("owned campaign tracking links", (it) => {
  it.effect("binds link generation to campaign version and conversation without publishing", () =>
    Effect.gen(function* () {
      const campaign = { ...createCampaign("Launch"), threadId: "chat", ownerKey: owner.key };
      yield* saveDocument("campaign", campaign.id, campaign, null);
      const input = {
        campaignId: campaign.id,
        version: 1,
        url: "https://shop.example/product",
        source: "instagram",
        campaign: "Launch",
      };
      const deps = { owner: () => Effect.succeed(owner) };
      const result = yield* executeCampaignLinkTool(scope, "djl_campaign_link", input, deps);
      assert.strictEqual(new URL(result.url).searchParams.get("utm_source"), "instagram");
      assert.isNull(result.websiteMetrics);
      const stale = yield* executeCampaignLinkTool(
        scope,
        "djl_campaign_link",
        { ...input, version: 2 },
        deps,
      ).pipe(Effect.flip);
      assert.strictEqual(stale instanceof MarketingError ? stale.status : null, 409);
      const other = yield* executeCampaignLinkTool(
        { ...scope, threadId: "other" },
        "djl_campaign_link",
        input,
        deps,
      ).pipe(Effect.flip);
      assert.strictEqual(other instanceof MarketingError ? other.status : null, 404);
    }),
  );
  it.effect("rejects another owner and model-supplied identity", () =>
    Effect.gen(function* () {
      const campaign = { ...createCampaign("Private"), threadId: "chat", ownerKey: "owner-b" };
      yield* saveDocument("campaign", campaign.id, campaign, null);
      const input = {
        campaignId: campaign.id,
        version: 1,
        url: "https://shop.example",
        source: "instagram",
        campaign: "Launch",
      };
      const deps = { owner: () => Effect.succeed(owner) };
      const denied = yield* executeCampaignLinkTool(scope, "djl_campaign_link", input, deps).pipe(
        Effect.flip,
      );
      assert.strictEqual(denied instanceof MarketingError ? denied.status : null, 404);
      const spoofed = yield* executeCampaignLinkTool(
        scope,
        "djl_campaign_link",
        { ...input, userId: "b" },
        deps,
      ).pipe(Effect.flip);
      assert.strictEqual(spoofed instanceof MarketingError ? spoofed.status : null, 400);
    }),
  );
});
