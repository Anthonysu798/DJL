import { Effect, Schema } from "effect";
import { buildCampaignTrackingLink, type Campaign } from "@synara/contracts";
import { resolveAgentOwner, assertAgentCampaignAccess } from "./agentScope";
import type { MarketingToolScope } from "./chatTools";
import { MarketingError, readDocument } from "./store";

export const CAMPAIGN_LINK_TOOLS = [
  {
    name: "djl_campaign_link",
    description:
      "Prepare a public HTTPS campaign tracking link for this conversation's owned campaign. Existing product query fields are retained. Does not update captions, publish, shorten URLs, or report website visits/leads. Website analytics must be connected separately; never invent attribution data.",
    inputSchema: {
      type: "object",
      properties: {
        campaignId: { type: "string" },
        version: { type: "integer" },
        url: { type: "string" },
        source: { type: "string" },
        campaign: { type: "string" },
        content: { type: "string" },
      },
      required: ["campaignId", "version", "url", "source", "campaign"],
      additionalProperties: false,
    },
    annotations: {
      title: "Campaign tracking link",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    _meta: { "djl/tool-classification": "read" as const },
  },
];
const Input = Schema.Struct({
  campaignId: Schema.String,
  version: Schema.Int,
  url: Schema.String,
  source: Schema.String,
  campaign: Schema.String,
  content: Schema.optional(Schema.String),
});

export function executeCampaignLinkTool(
  scope: MarketingToolScope,
  _name: string,
  raw: unknown,
  deps = { owner: resolveAgentOwner },
) {
  return Effect.gen(function* () {
    const input = yield* Effect.try({
      try: () => {
        if (
          !raw ||
          typeof raw !== "object" ||
          Array.isArray(raw) ||
          Object.keys(raw).some(
            (key) =>
              !["campaignId", "version", "url", "source", "campaign", "content"].includes(key),
          )
        )
          throw new Error("Unexpected input");
        return Schema.decodeUnknownSync(Input)(raw);
      },
      catch: () =>
        new MarketingError("Provide campaign, version, website link, source and campaign name."),
    });
    const owner = yield* deps.owner(scope);
    const record = yield* readDocument("campaign", input.campaignId);
    const campaign = record?.value as Campaign | undefined;
    if (!campaign || campaign.threadId !== scope.threadId)
      return yield* Effect.fail(
        new MarketingError("Campaign belongs to another conversation or is missing.", 404),
      );
    yield* assertAgentCampaignAccess(scope, campaign, owner);
    if (record!.version !== input.version)
      return yield* Effect.fail(
        new MarketingError("Campaign changed. Reload the latest version.", 409),
      );
    const url = yield* Effect.try({
      try: () => buildCampaignTrackingLink(input),
      catch: (error) =>
        new MarketingError(error instanceof Error ? error.message : "Invalid website link."),
    });
    return {
      url,
      campaignId: campaign.id,
      version: record!.version,
      websiteMetrics: null,
      limitations:
        "This prepares a tracking URL only. Website visits and leads require a connected website analytics source; none were fetched.",
    };
  });
}
