import { Schema } from "effect";
import { CloudSocialDraftInput } from "@synara/contracts/cloud";
import type { SocialConnectionService } from "../social/SocialConnectionService.ts";
import type { PublishingService } from "../social/publishing/PublishingService.ts";
import { ToolError, truncate, type AgentTool, type ToolContext } from "./tools.ts";

export interface SocialToolServices {
  connections: Pick<SocialConnectionService, "list">;
  publishing: Pick<PublishingService, "list" | "create" | "metrics">;
}
const owner = (ctx: ToolContext) => ({ userId: ctx.run.userId, orgId: ctx.run.orgId });
const output = (value: unknown) => ({ content: truncate(JSON.stringify(value)) });
async function safe<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof ToolError) throw error;
    // Database/provider errors may contain private values. Tool results are durable.
    throw new ToolError(
      "Social publishing could not be completed. Check account access, media, and draft settings in the review card.",
    );
  }
}

/** Read and prepare only. Confirmation and publishing never enter the model's tool registry. */
export function createSocialTools(services: SocialToolServices): AgentTool[] {
  return [
    {
      name: "social_publishing_status",
      description:
        "Read connected social accounts, provider availability, and publishing drafts/results in this conversation. Connecting does not publish. Unavailable platforms cannot publish.",
      parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
      quota: 8,
      async run(_args, ctx) {
        return safe(async () => {
          const [accounts, drafts] = await Promise.all([
            services.connections.list(owner(ctx)),
            services.publishing.list(owner(ctx), ctx.run.conversationId),
          ]);
          return output({ accounts, drafts });
        });
      },
    },
    {
      name: "prepare_social_draft",
      description:
        "Save an unconfirmed Instagram publishing draft for human review. Never publishes or confirms. Use actual connected account IDs and cloud file IDs from this conversation. scheduledAt must be an ISO instant with offset; timezone must be IANA. For TikTok, the user must choose privacy/interactions and confirm music usage in the review card; never invent consent.",
      parameters: {
        type: "object",
        properties: {
          draft_json: {
            type: "string",
            maxLength: 20000,
            description:
              "JSON object with caption, captions (account ID to caption), mediaFileIds (one cloud file ID), accountIds, scheduledAt, timezone. No owner, thread ID, confirmation, or publication fields.",
          },
        },
        required: ["draft_json"],
        additionalProperties: false,
      },
      quota: 4,
      async run(args, ctx) {
        return safe(async () => {
          let decoded: unknown;
          try {
            decoded = JSON.parse(String(args.draft_json));
          } catch {
            throw new ToolError("draft_json must be a JSON object.");
          }
          if (!decoded || typeof decoded !== "object" || Array.isArray(decoded))
            throw new ToolError("draft_json must be a JSON object.");
          const raw = decoded as Record<string, unknown>;
          const allowed = new Set([
            "caption",
            "captions",
            "mediaFileIds",
            "accountIds",
            "scheduledAt",
            "timezone",
          ]);
          if (Object.keys(raw).some((key) => !allowed.has(key)))
            throw new ToolError(
              "Draft contains unsupported fields. Identity, conversation, and consent cannot be supplied by a model.",
            );
          let input: CloudSocialDraftInput;
          try {
            input = Schema.decodeUnknownSync(CloudSocialDraftInput)({
              ...raw,
              threadId: ctx.run.conversationId,
            });
          } catch {
            throw new ToolError(
              "Provide valid caption, captions, mediaFileIds, accountIds, scheduledAt and timezone fields.",
            );
          }
          const accounts = await services.connections.list(owner(ctx));
          if (
            input.accountIds.some(
              (id) => accounts.accounts.find((account) => account.id === id)?.provider === "tiktok",
            )
          )
            throw new ToolError(
              "Prepare TikTok in the human review card so the user chooses privacy, interactions, disclosures, and music consent.",
            );
          for (const fileId of input.mediaFileIds) {
            const file = await ctx.file(fileId);
            if (!file || file.userId !== ctx.run.userId || file.orgId !== ctx.run.orgId)
              throw new ToolError("Use a cloud file attached or generated in this conversation.");
          }
          const draft = await services.publishing.create(owner(ctx), input);
          return output({ status: "awaiting_human_review", published: false, draft });
        });
      },
    },
    {
      name: "social_post_metrics",
      description:
        "Read actual provider metrics and permalink for a publication task in this conversation. Missing metrics remain null, not zero.",
      parameters: {
        type: "object",
        properties: {
          task_id: {
            type: "string",
            description: "An existing task ID returned by social_publishing_status.",
            maxLength: 64,
          },
        },
        required: ["task_id"],
        additionalProperties: false,
      },
      quota: 8,
      async run(args, ctx) {
        return safe(async () => {
          const taskId = String(args.task_id);
          const drafts = await services.publishing.list(owner(ctx), ctx.run.conversationId);
          if (!drafts.some((draft) => draft.tasks.some((task) => task.id === taskId)))
            throw new ToolError("No publishing task with that ID in this conversation.");
          return output(await services.publishing.metrics(owner(ctx), taskId));
        });
      },
    },
  ];
}
