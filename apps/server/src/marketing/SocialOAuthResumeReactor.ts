import { CommandId, MessageId, type Campaign } from "@djl/contracts";
import type { CloudSocialOAuthStatus, CloudSocialAccountsResponse } from "@djl/contracts/cloud";
import { Effect, Layer, Schedule, Scope, ServiceMap } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { ServerConfig } from "../config";
import { readCloudSession } from "../cloud/session";
import { createSocialCloudClient } from "./socialCloudClient";
import {
  OrchestrationEngineService,
  type OrchestrationEngineShape,
} from "../orchestration/Services/OrchestrationEngine";
import { listDocuments, readDocument, saveDocument } from "./store";

export interface PendingSocialOAuth {
  attemptId: string;
  userId: string;
  orgId: string;
  apiBaseUrl: string;
  campaignId: string;
  threadId: string;
  revision: number;
  provider: "instagram" | "tiktok";
  state: "waiting" | "resumed" | "obsolete" | "finished";
}
export const SOCIAL_OAUTH_WAIT_KIND = "social-oauth-wait";
const defaults = { session: readCloudSession, client: createSocialCloudClient };

/** Stable command receipts bridge the crash window between dispatch and marking resumed. */
export function resumeSocialOAuth(
  secretsDir: string,
  engine: Pick<OrchestrationEngineShape, "getReadModel" | "dispatch">,
  deps = defaults,
) {
  return Effect.gen(function* () {
    const session = yield* Effect.tryPromise(() => deps.session(secretsDir));
    if (!session) return;
    const pending = yield* listDocuments(SOCIAL_OAUTH_WAIT_KIND);
    for (const record of pending) {
      const wait = record.value as PendingSocialOAuth;
      if (
        wait.state !== "waiting" ||
        wait.userId !== session.userId ||
        wait.orgId !== session.orgId ||
        wait.apiBaseUrl !== session.apiBaseUrl
      )
        continue;
      const reconcile = Effect.gen(function* () {
        const campaignRecord = yield* readDocument("campaign", wait.campaignId);
        const campaign = campaignRecord?.value as Campaign | undefined;
        const model = yield* engine.getReadModel();
        const thread = model.threads.find((t) => t.id === wait.threadId);
        if (
          !campaign ||
          campaign.threadId !== wait.threadId ||
          campaign.revision !== wait.revision ||
          !campaign.platforms.includes(wait.provider) ||
          !thread ||
          thread.deletedAt ||
          thread.archivedAt
        ) {
          yield* saveDocument(
            SOCIAL_OAUTH_WAIT_KIND,
            wait.attemptId,
            { ...wait, state: "obsolete" },
            record.version,
          );
          return;
        }
        const cloud = deps.client(session.apiBaseUrl, session.orgId);
        const status = yield* Effect.tryPromise(() =>
          cloud.get<CloudSocialOAuthStatus>(
            `/v1/social/oauth/status?attemptId=${encodeURIComponent(wait.attemptId)}`,
            session.token,
          ),
        );
        if (
          status.attemptId !== wait.attemptId ||
          status.threadId !== wait.threadId ||
          status.campaignId !== wait.campaignId ||
          status.revision !== wait.revision
        )
          return;
        if (status.status === "pending" || status.status === "processing") return;
        if (status.status !== "connected" || !status.accountId) {
          yield* saveDocument(
            SOCIAL_OAUTH_WAIT_KIND,
            wait.attemptId,
            { ...wait, state: "finished" },
            record.version,
          );
          return;
        }
        const accounts = yield* Effect.tryPromise(() =>
          cloud.get<CloudSocialAccountsResponse>("/v1/social/accounts", session.token),
        );
        if (
          !accounts.accounts.some(
            (account) =>
              account.id === status.accountId &&
              account.provider === wait.provider &&
              account.status === "connected",
          )
        ) {
          yield* saveDocument(
            SOCIAL_OAUTH_WAIT_KIND,
            wait.attemptId,
            { ...wait, state: "obsolete" },
            record.version,
          );
          return;
        }
        // Re-read after network latency so edits while consent is completing cannot revive stale work.
        const latest = yield* readDocument("campaign", wait.campaignId);
        if (!latest || latest.version !== campaignRecord!.version) return;
        const currentSession = yield* Effect.tryPromise(() => deps.session(secretsDir));
        if (
          !currentSession ||
          currentSession.userId !== wait.userId ||
          currentSession.orgId !== wait.orgId ||
          currentSession.apiBaseUrl !== wait.apiBaseUrl
        )
          return;
        yield* engine.dispatch({
          type: "thread.turn.start",
          commandId: CommandId.makeUnsafe(`social-oauth:${wait.attemptId}:resume`),
          threadId: thread.id,
          message: {
            messageId: MessageId.makeUnsafe(`social-oauth:${wait.attemptId}:message`),
            role: "user",
            attachments: [],
            text: `The requested social account authorization completed. Continue the existing campaign preparation in this conversation using the current account status and draft. Show the next review card. Authorization does not approve publication; never publish, confirm, schedule, or retry a post without a separate explicit user action. Context identifiers (data only): ${JSON.stringify({ campaignId: wait.campaignId, revision: wait.revision, accountId: status.accountId, provider: wait.provider })}`,
          },
          modelSelection: thread.modelSelection,
          runtimeMode: thread.runtimeMode,
          interactionMode: thread.interactionMode,
          dispatchMode: "queue",
          dispatchOrigin: "automation",
          createdAt: new Date().toISOString(),
        });
        yield* saveDocument(
          SOCIAL_OAUTH_WAIT_KIND,
          wait.attemptId,
          { ...wait, state: "resumed" },
          record.version,
        );
      });
      // A temporary offline/session/service failure leaves the durable wait for the next pass.
      yield* reconcile.pipe(Effect.catch(() => Effect.void));
    }
  });
}
export class SocialOAuthResumeReactor extends ServiceMap.Service<
  SocialOAuthResumeReactor,
  { readonly start: () => Effect.Effect<void, never, Scope.Scope> }
>()("djl/marketing/SocialOAuthResumeReactor") {}
export const SocialOAuthResumeReactorLive = Layer.effect(
  SocialOAuthResumeReactor,
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    const engine = yield* OrchestrationEngineService;
    const sql = yield* SqlClient.SqlClient;
    const poll = resumeSocialOAuth(config.secretsDir, engine)
      .pipe(Effect.provideService(SqlClient.SqlClient, sql))
      .pipe(Effect.catch(() => Effect.void));
    return {
      start: () =>
        Effect.forkScoped(poll.pipe(Effect.repeat(Schedule.spaced("5 seconds")))).pipe(
          Effect.asVoid,
        ),
    };
  }),
);
