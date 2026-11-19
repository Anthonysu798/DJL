import path from "node:path";
import { assertAgentCampaignAccess, agentOwnerFromSession } from "./agentScope";
import { Effect, Schema } from "effect";
import type { Campaign } from "@synara/contracts";
import type {
  CloudSocialAccountsResponse,
  CloudSocialOAuthStartResponse,
  CloudSocialOAuthStatus,
} from "@synara/contracts/cloud";
import { createSocialCloudClient } from "./socialCloudClient";
import { readCloudSession } from "../cloud/session";
import { SOCIAL_OAUTH_WAIT_KIND, type PendingSocialOAuth } from "./SocialOAuthResumeReactor";
import { MarketingError, readDocument, saveDocument } from "./store";

const Input = Schema.Struct({
  action: Schema.Literals(["state", "connect", "disconnect"]),
  campaignId: Schema.String,
  threadId: Schema.String,
  version: Schema.optional(Schema.Int),
  provider: Schema.optional(Schema.Literals(["instagram", "tiktok"])),
  accountId: Schema.optional(Schema.String),
});
const defaults = { session: readCloudSession, client: createSocialCloudClient };

/** Local chat scope is checked before forwarding to the independently authenticated cloud API. */
export function socialBridge(secretsDir: string, raw: unknown, deps = defaults) {
  return Effect.gen(function* () {
    const input = yield* Effect.try({
      try: () => Schema.decodeUnknownSync(Input)(raw),
      catch: () => new MarketingError("Invalid account action."),
    });
    const record = yield* readDocument("campaign", input.campaignId);
    const campaign = record?.value as Campaign | undefined;
    if (!campaign || campaign.threadId !== input.threadId)
      return yield* Effect.fail(
        new MarketingError("Campaign belongs to another conversation or is missing.", 404),
      );
    const session = yield* Effect.tryPromise({
      try: () => deps.session(secretsDir),
      catch: () => new MarketingError("Could not read your DJL Cloud session.", 503),
    });
    if (!session)
      return yield* Effect.fail(
        new MarketingError("Sign in to DJL Cloud to connect your social accounts.", 401),
      );
    const root = path.dirname(secretsDir);
    yield* assertAgentCampaignAccess(
      {
        threadId: input.threadId,
        authorizedRoot: root,
        attachmentFiles: [],
        stateDir: root,
        secretsDir,
      },
      campaign,
      agentOwnerFromSession(session),
    );
    if (input.action !== "state" && input.version !== record!.version)
      return yield* Effect.fail(
        new MarketingError("Campaign changed. Review the latest card.", 409),
      );
    let pending: PendingSocialOAuth | undefined;
    const result = yield* Effect.tryPromise({
      try: async () => {
        const cloud = deps.client(session.apiBaseUrl, session.orgId);
        if (input.action === "state") {
          const query = new URLSearchParams({
            threadId: input.threadId,
            campaignId: input.campaignId,
          });
          const [accounts, attempts] = await Promise.all([
            cloud.get<CloudSocialAccountsResponse>("/v1/social/accounts", session.token),
            cloud.get<{ attempts: CloudSocialOAuthStatus[] }>(
              `/v1/social/oauth/attempts?${query}`,
              session.token,
            ),
          ]);
          return { ...accounts, ...attempts };
        }
        if (input.action === "connect") {
          if (!input.provider || !campaign.platforms.includes(input.provider))
            throw new MarketingError("Select this platform in the campaign before connecting.");
          const started = await cloud.post<CloudSocialOAuthStartResponse>(
            "/v1/social/oauth/start",
            {
              provider: input.provider,
              threadId: campaign.threadId,
              campaignId: campaign.id,
              revision: campaign.revision,
              ...(input.accountId ? { accountId: input.accountId } : {}),
            },
            session.token,
          );
          pending = {
            attemptId: started.attemptId,
            userId: session.userId,
            orgId: session.orgId,
            apiBaseUrl: session.apiBaseUrl,
            campaignId: campaign.id,
            threadId: campaign.threadId!,
            revision: campaign.revision,
            provider: input.provider,
            state: "waiting",
          };
          return started;
        }
        if (!input.accountId) throw new MarketingError("Select an account.");
        return cloud.post<{ disconnected: boolean }>(
          "/v1/social/accounts/disconnect",
          { accountId: input.accountId },
          session.token,
        );
      },
      catch: (error) =>
        error instanceof MarketingError
          ? error
          : new MarketingError(
              "Social account service is unavailable. Please try again later.",
              503,
            ),
    });
    if (pending) yield* saveDocument(SOCIAL_OAUTH_WAIT_KIND, pending.attemptId, pending, null);
    return result;
  });
}
