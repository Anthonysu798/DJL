import { CommandId, MessageId, type Campaign } from "@djl/contracts";
import { CloudSocialReportsResponse, type CloudSocialWeeklyReport } from "@djl/contracts/cloud";
import { Effect, Layer, Schedule, Schema, Scope, ServiceMap } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { ServerConfig } from "../config";
import {
  OrchestrationEngineService,
  type OrchestrationEngineShape,
} from "../orchestration/Services/OrchestrationEngine";
import { readCloudSession } from "../cloud/session";
import { agentOwnerFromSession, isAgentCampaignAccessible } from "./agentScope";
import { createSocialCloudClient } from "./socialCloudClient";
import { listDocuments, readDocument, saveDocument } from "./store";

interface ReportBinding {
  apiBaseUrl: string;
  userId: string;
  orgId: string;
  campaignId: string;
  draftId: string;
}

const DELIVERY_KIND = "social-report-delivery";
function recapText(report: CloudSocialWeeklyReport) {
  const metrics = ["views", "likes", "comments", "shares"] as const;
  return [
    `Weekly social recap · ${report.periodStart} to ${report.periodEnd}`,
    `${report.publishedPosts} published ${report.publishedPosts === 1 ? "post" : "posts"} recorded in this conversation during this period.`,
    ...report.providers.map(
      (provider) =>
        `${provider.provider} · ${provider.publishedPosts} posts\n${metrics
          .map(
            (metric) =>
              `${metric[0]!.toUpperCase()}${metric.slice(1)}: ${provider.metrics[metric] === null ? "Unavailable" : provider.metrics[metric]!.toLocaleString("en-US")}`,
          )
          .join(" · ")}`,
    ),
    `Cumulative official platform metrics retrieved ${report.retrievedAt}. These are lifetime counts for the period's posts, not activity gained during the week; counts may change after collection.`,
    ...(report.partial
      ? ["Some platform metrics were unavailable; unavailable values are not zero."]
      : []),
    ...(report.truncated
      ? [
          `Metrics were checked for ${report.inspectedPosts} of ${report.publishedPosts} posts; totals may cover only this sample.`,
        ]
      : []),
    "Open Weekly in-chat recap in this chat's publishing panel for saved report details.",
  ].join("\n\n");
}

const defaults = { session: readCloudSession, client: createSocialCloudClient };
/** Local receipts optimize polling; orchestration receipts close the dispatch/save crash window. */
export function deliverSocialReports(
  secretsDir: string,
  engine: Pick<OrchestrationEngineShape, "getReadModel" | "dispatch">,
  deps = defaults,
) {
  return Effect.gen(function* () {
    const session = yield* Effect.tryPromise(() => deps.session(secretsDir));
    if (!session) return;
    const owner = agentOwnerFromSession(session);
    const records = yield* listDocuments("social-draft-link");
    const bindings = records.map((record) => record.value as ReportBinding);
    const ownsBinding = (binding: ReportBinding) =>
      binding.userId === owner.userId &&
      binding.orgId === owner.orgId &&
      binding.apiBaseUrl === owner.apiBaseUrl;
    for (const record of records) {
      const binding = record.value as ReportBinding;
      if (!ownsBinding(binding)) continue;
      const reconcile = Effect.gen(function* () {
        const saved = yield* readDocument("campaign", binding.campaignId);
        const campaign = saved?.value as Campaign | undefined;
        if (!campaign || !isAgentCampaignAccessible(campaign, owner, bindings)) return;
        const model = yield* engine.getReadModel();
        const thread = model.threads.find((thread) => thread.id === campaign.threadId);
        if (!thread || thread.deletedAt || thread.archivedAt) return;
        const cloud = deps.client(session.apiBaseUrl, session.orgId);
        const response = yield* Effect.tryPromise(() =>
          cloud.get<CloudSocialReportsResponse>(
            `/v1/social/drafts/${encodeURIComponent(binding.draftId)}/reports`,
            session.token,
          ),
        );
        const state = yield* Effect.try({
          try: () => Schema.decodeUnknownSync(CloudSocialReportsResponse)(response),
          catch: (cause) => cause,
        });
        if (
          !state.schedule.enabled ||
          state.schedule.draftId !== binding.draftId ||
          state.schedule.threadId !== thread.id
        )
          return;
        for (const report of state.reports.toReversed()) {
          if (report.threadId !== thread.id) continue;
          const deliveryId = `${owner.key}:${thread.id}:${report.id}`;
          if (yield* readDocument(DELIVERY_KIND, deliveryId)) continue;
          // Network waits must not carry data across a sign-out, owner change, or local rebind.
          const currentSession = yield* Effect.tryPromise(() => deps.session(secretsDir));
          if (!currentSession || agentOwnerFromSession(currentSession).key !== owner.key) return;
          const currentBinding = yield* readDocument("social-draft-link", binding.draftId);
          const currentCampaign = yield* readDocument("campaign", binding.campaignId);
          if (
            currentBinding?.version !== record.version ||
            currentCampaign?.version !== saved!.version
          )
            return;
          const currentModel = yield* engine.getReadModel();
          const currentThread = currentModel.threads.find(
            (candidate) => candidate.id === thread.id,
          );
          if (!currentThread || currentThread.deletedAt || currentThread.archivedAt) return;
          yield* engine.dispatch({
            type: "thread.message.assistant.complete",
            commandId: CommandId.makeUnsafe(`social-report:${deliveryId}:deliver`),
            threadId: thread.id,
            messageId: MessageId.makeUnsafe(`social-report:${deliveryId}:message`),
            text: recapText(report),
            createdAt: new Date().toISOString(),
          });
          yield* saveDocument(
            DELIVERY_KIND,
            deliveryId,
            {
              ownerKey: owner.key,
              threadId: thread.id,
              reportId: report.id,
            },
            null,
          );
        }
      });
      // Offline or transient failures preserve cloud reports for a later pass.
      yield* reconcile.pipe(Effect.catch(() => Effect.void));
    }
  });
}

export class SocialReportDeliveryReactor extends ServiceMap.Service<
  SocialReportDeliveryReactor,
  { readonly start: () => Effect.Effect<void, never, Scope.Scope> }
>()("djl/marketing/SocialReportDeliveryReactor") {}

export const SocialReportDeliveryReactorLive = Layer.effect(
  SocialReportDeliveryReactor,
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    const engine = yield* OrchestrationEngineService;
    const sql = yield* SqlClient.SqlClient;
    const poll = deliverSocialReports(config.secretsDir, engine).pipe(
      Effect.provideService(SqlClient.SqlClient, sql),
      Effect.catch(() => Effect.void),
    );
    return {
      start: () =>
        Effect.forkScoped(poll.pipe(Effect.repeat(Schedule.spaced("1 minute")))).pipe(
          Effect.asVoid,
        ),
    };
  }),
);
