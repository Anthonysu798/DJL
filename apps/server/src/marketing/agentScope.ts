import { createHash } from "node:crypto";
import path from "node:path";
import { Effect } from "effect";
import { readCloudSession, type CloudSession } from "../cloud/session";
import type { MarketingToolScope } from "./chatTools";
import { MarketingError, listDocuments, readDocument } from "./store";

/** Identity comes only from the server's stored session, never tool arguments. */
export function readAgentOwner(scope: MarketingToolScope) {
  return Effect.gen(function* () {
    const session = yield* Effect.tryPromise({
      try: () => readCloudSession(scope.secretsDir ?? path.join(scope.stateDir, "secrets")),
      catch: () => new MarketingError("Could not read your DJL session.", 503),
    });
    if (!session) return null;
    return agentOwnerFromSession(session);
  });
}

export function resolveAgentOwner(scope: MarketingToolScope) {
  return Effect.gen(function* () {
    const owner = yield* readAgentOwner(scope);
    if (!owner)
      return yield* Effect.fail(
        new MarketingError("Sign in to DJL to use your saved social workspace.", 401),
      );
    return owner;
  });
}
export function assertMarketingRecordOwner(scope: MarketingToolScope, value: unknown) {
  return Effect.gen(function* () {
    const key = (value as { ownerKey?: string } | null)?.ownerKey;
    if (key && key !== (yield* readAgentOwner(scope))?.key)
      return yield* Effect.fail(
        new MarketingError("This item belongs to another social workspace.", 404),
      );
  });
}

interface OwnerIdentity {
  key: string;
  userId: string;
  orgId: string;
  apiBaseUrl: string;
}
interface CampaignReference {
  id: string;
  assetIds: readonly string[];
  ownerKey?: string;
}
interface LegacyBinding {
  campaignId?: string;
  userId?: string;
  orgId?: string;
  apiBaseUrl?: string;
}
export function isAgentCampaignAccessible(
  campaign: CampaignReference,
  owner: OwnerIdentity | null,
  bindings: readonly LegacyBinding[],
): boolean {
  if (campaign.ownerKey) return campaign.ownerKey === owner?.key;
  if (!owner) return true;
  return bindings.some(
    (binding) =>
      binding.campaignId === campaign.id &&
      binding.userId === owner.userId &&
      binding.orgId === owner.orgId &&
      binding.apiBaseUrl === owner.apiBaseUrl,
  );
}
export function assertAgentCampaignAccess(
  scope: MarketingToolScope,
  value: unknown,
  authenticatedOwner?: OwnerIdentity | null,
) {
  return Effect.gen(function* () {
    const owner =
      authenticatedOwner === undefined ? yield* readAgentOwner(scope) : authenticatedOwner;
    const bindings = (yield* listDocuments("social-draft-link")).map(
      (record) => record.value as LegacyBinding,
    );
    if (!isAgentCampaignAccessible(value as CampaignReference, owner, bindings))
      return yield* Effect.fail(
        new MarketingError(
          "This campaign belongs to another social workspace or has no verified owner.",
          404,
        ),
      );
  });
}
export function assertAgentMediaAccess(
  scope: MarketingToolScope,
  value: unknown,
  authenticatedOwner?: OwnerIdentity | null,
) {
  return Effect.gen(function* () {
    const asset = value as { id: string; ownerKey?: string };
    const owner =
      authenticatedOwner === undefined ? yield* readAgentOwner(scope) : authenticatedOwner;
    if (asset.ownerKey) {
      if (asset.ownerKey !== owner?.key)
        return yield* Effect.fail(
          new MarketingError("This media belongs to another social workspace.", 404),
        );
      return;
    }
    if (!owner) return;
    const indexed = (yield* readDocument("agent-media", `${owner.key}:${asset.id}`))?.value as
      | { ownerKey?: string; assetId?: string }
      | undefined;
    if (indexed?.ownerKey === owner.key && indexed.assetId === asset.id) return;
    const bindings = (yield* listDocuments("social-draft-link")).map(
      (record) => record.value as LegacyBinding,
    );
    const campaigns = (yield* listDocuments("campaign")).map(
      (record) => record.value as CampaignReference,
    );
    if (
      !campaigns.some(
        (campaign) =>
          isAgentCampaignAccessible(campaign, owner, bindings) &&
          campaign.assetIds.includes(asset.id),
      )
    )
      return yield* Effect.fail(
        new MarketingError("This media has no verified owner in your social workspace.", 404),
      );
  });
}

export function agentOwnerFromSession(
  session: Pick<CloudSession, "apiBaseUrl" | "userId" | "orgId">,
) {
  return {
    key: createHash("sha256")
      .update(JSON.stringify([session.apiBaseUrl, session.userId, session.orgId]))
      .digest("hex")
      .slice(0, 32),
    userId: session.userId,
    orgId: session.orgId,
    apiBaseUrl: session.apiBaseUrl,
  };
}
