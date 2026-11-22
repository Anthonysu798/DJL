import { multiPostScope } from "../multipost/live";
import { importLegacyCampaign } from "../multipost/legacy";
import { Effect, Schema } from "effect";
import path from "node:path";
import type { Campaign } from "@djl/contracts";
import { publishingBridge } from "./publishingBridge";
import { socialBridge } from "./socialBridge";
import { readDocument, MarketingError } from "./store";
import type { MarketingToolScope } from "./chatTools";

const CONNECTION_GUIDANCE =
  "When an available provider needs authorization, the user selects the in-chat Connect button. That button starts OAuth and persists the waiting task for this campaign and revision; the local runtime automatically resumes this conversation after successful authorization while that context remains current. No separate automation setup is needed. This status tool does not start OAuth or create the waiting task. Authorization is never publishing consent: show the final review card and require the user's separate confirmation before scheduling or publishing.";

export const SOCIAL_TOOLS = [
  {
    name: "djl_social_status",
    description: `Read real connected accounts, publishing drafts and per-platform jobs for a campaign in this conversation. Never infer connection, publication, or metrics. ${CONNECTION_GUIDANCE}`,
    inputSchema: {
      type: "object",
      properties: { campaignId: { type: "string" } },
      required: ["campaignId"],
      additionalProperties: false,
    },
    annotations: {
      title: "Check social accounts and jobs",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    _meta: { "djl/tool-classification": "read" as const },
  },
  {
    name: "djl_prepare_social_publish",
    description:
      "Prepare or revise a cloud publishing preview from the current saved campaign. Does NOT approve, enqueue or publish. Reuse draftId/revision for schedule edits. For immediate publishing set publicationMode=now and timezone; do not invent a future schedule or ask for a time. For scheduling set publicationMode=scheduled and provide the exact scheduledAt ISO timestamp with offset plus IANA timezone from user context. Preparing never creates a posting job. Choose only account IDs returned by status. TikTok privacy and consent must be selected by the user in the card. User must confirm the final card after every change.",
    inputSchema: {
      type: "object",
      properties: {
        campaignId: { type: "string" },
        version: { type: "integer" },
        accountIds: { type: "array", items: { type: "string" } },
        publicationMode: { type: "string", enum: ["now", "scheduled"] },
        scheduledAt: { type: "string" },
        timezone: { type: "string" },
        draftId: { type: "string" },
        revision: { type: "integer" },
      },
      required: ["campaignId", "version", "accountIds", "timezone"],
      additionalProperties: false,
    },
    annotations: {
      title: "Prepare social publishing review",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    _meta: { "djl/tool-classification": "modify-copy" as const },
  },
  {
    name: "djl_cancel_social_task",
    description:
      "Cancel a specific not-yet-published platform task only when the user requests cancellation. Read status first and supply that task revision. Does not delete published posts or cancel other platforms.",
    inputSchema: {
      type: "object",
      properties: {
        campaignId: { type: "string" },
        version: { type: "integer" },
        taskId: { type: "string" },
        revision: { type: "integer" },
      },
      required: ["campaignId", "version", "taskId", "revision"],
      additionalProperties: false,
    },
    annotations: {
      title: "Cancel scheduled social post",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: true,
    },
    _meta: { "djl/tool-classification": "modify-copy" as const },
  },
  {
    name: "djl_social_metrics",
    description:
      "Read official platform metrics for a published task. Missing values are unavailable, never zero. Preserve returned timestamp and real post link.",
    inputSchema: {
      type: "object",
      properties: {
        campaignId: { type: "string" },
        version: { type: "integer" },
        taskId: { type: "string" },
        revision: { type: "integer" },
      },
      required: ["campaignId", "version", "taskId", "revision"],
      additionalProperties: false,
    },
    annotations: {
      title: "Read social post results",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    _meta: { "djl/tool-classification": "read" as const },
  },
];
const Args = Schema.Struct({
  campaignId: Schema.String,
  version: Schema.optional(Schema.Int),
  accountIds: Schema.optional(Schema.Array(Schema.String)),
  publicationMode: Schema.optional(Schema.Literals(["now", "scheduled"])),
  scheduledAt: Schema.optional(Schema.String),
  timezone: Schema.optional(Schema.String),
  draftId: Schema.optional(Schema.String),
  revision: Schema.optional(Schema.Int),
  taskId: Schema.optional(Schema.String),
});
export function executeSocialTool(scope: MarketingToolScope, name: string, raw: unknown) {
  return Effect.gen(function* () {
    const args = yield* Effect.try({
      try: () => Schema.decodeUnknownSync(Args)(raw),
      catch: () => new MarketingError("Invalid social tool input."),
    });
    const saved = yield* readDocument("campaign", args.campaignId);
    if (!saved || (saved.value as Campaign).threadId !== scope.threadId)
      return yield* Effect.fail(
        new MarketingError("Campaign belongs to another conversation or is missing.", 404),
      );
    const config = {
      stateDir: scope.stateDir,
      secretsDir: scope.secretsDir ?? path.join(scope.stateDir, "secrets"),
    };
    if (name === "djl_social_status") {
      const accounts = yield* socialBridge(config.secretsDir, {
        action: "state",
        campaignId: args.campaignId,
        threadId: scope.threadId,
      });
      const publishing = yield* publishingBridge(config, {
        action: "state",
        campaignId: args.campaignId,
        threadId: scope.threadId,
      });
      return {
        accounts,
        publishing,
        currentTime: new Date().toISOString(),
        localTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        publishingRequiresUserConfirmation: true,
        connectionGuidance: CONNECTION_GUIDANCE,
      };
    }
    if (name === "djl_prepare_social_publish") {
      const localScope = yield* Effect.promise(() =>
        multiPostScope(scope.authorizedRoot, scope.threadId, scope.stateDir),
      );
      return {
        result: yield* importLegacyCampaign(config, localScope, {
          action: "import-campaign",
          campaignId: args.campaignId,
          version: args.version!,
          ...(args.accountIds ? { accountIds: [...args.accountIds] } : {}),
          ...(args.publicationMode ? { publicationMode: args.publicationMode } : {}),
          ...(args.scheduledAt ? { scheduledAt: args.scheduledAt } : {}),
          ...(args.timezone ? { timezone: args.timezone } : {}),
        }),
        engine: "multipost",
        requiresUserReview: true,
      };
    }
    const action =
      name === "djl_prepare_social_publish"
        ? "prepare"
        : name === "djl_cancel_social_task"
          ? "task"
          : name === "djl_social_metrics"
            ? "metrics"
            : null;
    if (!action) return yield* Effect.fail(new MarketingError("Unknown social tool."));
    return {
      result: yield* publishingBridge(config, {
        ...args,
        threadId: scope.threadId,
        action,
        ...(action === "task" ? { taskAction: "cancel" } : {}),
      }),
    };
  });
}
