import { randomUUID } from "node:crypto";
import path from "node:path";
import { Effect } from "effect";
import type * as SqlClient from "effect/unstable/sql/SqlClient";
import type { Campaign } from "@synara/contracts";
import type { CloudSocialAccountsResponse, CloudSocialDraft } from "@synara/contracts/cloud";
import type {
  SocialPreparationTool,
  SocialWorkflow,
  SocialWorkflowRun,
  SocialInboxItem,
  SocialInboxResponse,
  SocialCoachPost,
  SocialCoachProvider,
} from "@synara/contracts";
import type { MarketingToolScope } from "./chatTools";
import { resolveAgentOwner } from "./agentScope";
import { publishingBridge } from "./publishingBridge";
import { listDocuments, readDocument, saveDocument, MarketingError } from "./store";

const PREPARATION_TOOLS: SocialPreparationTool[] = [
  "djl_import_product_url",
  "djl_brand_memory",
  "djl_media_library",
  "djl_inspect_social_media",
  "djl_repurpose_video",
  "djl_transcribe_video",
  "djl_prepare_marketing",
];
const string = { type: "string" };
const integer = { type: "integer", minimum: 1 };
const object = { type: "object", additionalProperties: true };
export const WORKFLOW_TOOLS = [
  {
    name: "djl_social_workflows",
    description:
      "Save/list/archive reusable preparation workflows or run them as durable per-step plans in this conversation. Use $source:key as a whole argument string for supplied sources. To unblock missing inputs on a saved run, call progress with runId/version/stepId, status=pending and new sources; this preserves completed work. Run and progress do not execute tools: execute each returned current step with its listed preparation tool, then record actual results with progress. Only preparation tools are allowed. Completion always requires human review; never approves, confirms or publishes.",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["list", "save", "run", "progress", "archive"] },
        workflowId: string,
        version: integer,
        name: string,
        steps: {
          type: "array",
          minItems: 1,
          maxItems: 30,
          items: {
            type: "object",
            properties: {
              tool: { type: "string", enum: PREPARATION_TOOLS },
              label: string,
              args: object,
            },
            required: ["tool", "label"],
            additionalProperties: false,
          },
        },
        sources: { type: "object", additionalProperties: string },
        runId: string,
        stepId: string,
        status: { type: "string", enum: ["pending", "completed", "blocked"] },
        result: object,
        reason: string,
      },
      required: ["action"],
      additionalProperties: false,
    },
    annotations: {
      title: "Saved preparation workflows",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    _meta: { "djl/tool-classification": "modify-copy" as const },
  },
  {
    name: "djl_social_inbox",
    description:
      "Read a live inbox of this signed-in user's campaigns across chats, unconfirmed previews, publishing tasks, provider issues and upcoming schedules. cancel/retry/reschedule require exact campaignId, threadId, local version, draftId and revision; cancel/retry also require taskId. Reschedule prepares a fresh unconfirmed preview with a future scheduledAt/timezone; it requires a new explicit review and confirmation. Never confirms or publishes.",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["list", "cancel", "retry", "reschedule"] },
        campaignId: string,
        threadId: string,
        version: integer,
        draftId: string,
        taskId: string,
        revision: integer,
        scheduledAt: string,
        timezone: string,
      },
      required: ["action"],
      additionalProperties: false,
    },
    annotations: {
      title: "Live social review inbox",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    _meta: { "djl/tool-classification": "modify-copy" as const },
  },
  {
    name: "djl_social_coach",
    description:
      "Read actual published-task metrics from official providers for the last 1–90 days across the signed-in user's owned campaigns. Returns official post URLs, retrieval times, separate provider averages with sample counts and null for unavailable metrics. No invented score, causal conclusion or best posting time. Publication date uses the published task's updatedAt proxy, which is disclosed in limitations.",
    inputSchema: {
      type: "object",
      properties: { days: { type: "integer", minimum: 1, maximum: 90 } },
      additionalProperties: false,
    },
    annotations: {
      title: "Official social results",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    _meta: { "djl/tool-classification": "read" as const },
  },
];

type Owner = Effect.Success<ReturnType<typeof resolveAgentOwner>>;
type Bridge = (
  config: { stateDir: string; secretsDir: string },
  raw: unknown,
) => Effect.Effect<unknown, unknown, SqlClient.SqlClient>;
interface Dependencies {
  owner: typeof resolveAgentOwner;
  bridge: Bridge;
  now: () => Date;
}
const defaults: Dependencies = {
  owner: resolveAgentOwner,
  bridge: publishingBridge,
  now: () => new Date(),
};
type Args = Record<string, unknown>;
const invalid = (message: string) => new MarketingError(message);
function args(raw: unknown, keys: string[]): Args {
  if (
    !raw ||
    typeof raw !== "object" ||
    Array.isArray(raw) ||
    Object.keys(raw).some((key) => !keys.includes(key))
  )
    throw invalid(
      "Invalid social workspace arguments. Identity is supplied by the signed-in session.",
    );
  return raw as Args;
}
function text(value: unknown, label: string, max = 500): string {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw invalid(`Provide ${label}.`);
  return value.trim();
}
function version(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1)
    throw new MarketingError("This item changed. Reload its current version.", 409);
  return value as number;
}
function dictionary(value: unknown): Args {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw invalid("Provide an argument object.");
  if (JSON.stringify(value).length > 50000) throw invalid("Workflow arguments are too large.");
  return value as Args;
}
function sourceValues(value: unknown): Record<string, string> {
  const values = dictionary(value ?? {});
  if (
    Object.entries(values).some(
      ([key, value]) =>
        !/^[a-zA-Z0-9_-]{1,80}$/.test(key) || typeof value !== "string" || value.length > 10000,
    )
  )
    throw invalid("Provide named text source values, at most 10000 characters each.");
  return values as Record<string, string>;
}
function substitute(
  value: unknown,
  sources: Record<string, string>,
  missing: Set<string>,
): unknown {
  if (typeof value === "string" && value.startsWith("$source:")) {
    const key = value.slice(8);
    const supplied = Object.hasOwn(sources, key) && Boolean(sources[key]?.trim());
    if (!supplied) missing.add(key);
    return supplied ? sources[key] : value;
  }
  if (Array.isArray(value)) return value.map((item) => substitute(item, sources, missing));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, substitute(item, sources, missing)]),
    );
  return value;
}
function runState(steps: SocialWorkflowRun["steps"]) {
  const index = steps.findIndex((step) => step.status !== "completed");
  return {
    currentStep: index < 0 ? null : index,
    status:
      index < 0
        ? ("awaiting_review" as const)
        : steps[index]!.status === "blocked"
          ? ("blocked" as const)
          : ("ready" as const),
  };
}
function ownedRecord<T extends { ownerKey: string }>(kind: string, id: unknown, owner: Owner) {
  return Effect.gen(function* () {
    const key = yield* Effect.try({
      try: () => text(id, "the saved item ID"),
      catch: (e) => e as MarketingError,
    });
    const record = key.startsWith(`${owner.key}:`) ? yield* readDocument(kind, key) : null;
    if (!record || (record.value as T).ownerKey !== owner.key)
      return yield* Effect.fail(
        new MarketingError("Saved item is missing or belongs to another account.", 404),
      );
    return { value: record.value as T, version: record.version };
  });
}
function workflow(scope: MarketingToolScope, input: Args, owner: Owner, deps: Dependencies) {
  return Effect.gen(function* () {
    if (input.action === "list")
      return {
        workflows: (yield* listDocuments("agent-workflow")).filter(
          (r) =>
            (r.value as SocialWorkflow).ownerKey === owner.key &&
            !(r.value as SocialWorkflow).archived,
        ),
        runs: (yield* listDocuments("agent-workflow-run")).filter(
          (r) =>
            (r.value as SocialWorkflowRun).ownerKey === owner.key &&
            (r.value as SocialWorkflowRun).threadId === scope.threadId,
        ),
        requiresReview: true,
      };
    const now = deps.now().toISOString();
    if (input.action === "progress") {
      const run = yield* ownedRecord<SocialWorkflowRun>("agent-workflow-run", input.runId, owner);
      if (run.value.threadId !== scope.threadId)
        return yield* Effect.fail(new MarketingError("Run belongs to another conversation.", 404));
      const expected = yield* Effect.try({
        try: () => version(input.version),
        catch: (e) => e as MarketingError,
      });
      if (run.version !== expected)
        return yield* Effect.fail(
          new MarketingError("Run changed. Reload before continuing.", 409),
        );
      const current = run.value.currentStep;
      if (current === null || run.value.steps[current]!.id !== input.stepId)
        return yield* Effect.fail(invalid("Only the current step may record progress."));
      if (!["pending", "completed", "blocked"].includes(String(input.status)))
        return yield* Effect.fail(invalid("Choose a step status."));
      const sources = { ...run.value.sources, ...sourceValues(input.sources) };
      const resolvedSteps = run.value.steps.map((step) => {
        if (step.status === "completed") return step;
        const missing = new Set<string>();
        const resolvedArgs = substitute(step.sourceArgs ?? step.args, sources, missing) as Args;
        const wasMissing = step.reason?.startsWith("Missing sources:");
        return {
          ...step,
          args: resolvedArgs,
          status: missing.size
            ? ("blocked" as const)
            : wasMissing
              ? ("pending" as const)
              : step.status,
          reason: missing.size
            ? `Missing sources: ${[...missing].join(", ")}`
            : wasMissing
              ? null
              : step.reason,
        };
      });
      // Status changes cannot bypass unresolved inputs; supply them before executing the step.
      if (
        input.status === "completed" &&
        resolvedSteps[current]!.reason?.startsWith("Missing sources:")
      )
        return yield* Effect.fail(
          invalid("Supply missing sources with progress before completing this step."),
        );
      const steps = [...resolvedSteps];
      const step = steps[current]!;
      steps[current] = {
        ...step,
        status: step.reason?.startsWith("Missing sources:")
          ? "blocked"
          : (input.status as "pending" | "completed" | "blocked"),
        result: input.result ? dictionary(input.result) : null,
        reason: step.reason?.startsWith("Missing sources:")
          ? step.reason
          : input.status === "blocked"
            ? text(input.reason ?? "Preparation needs attention.", "a blocker reason", 1000)
            : null,
      };
      const value: SocialWorkflowRun = {
        ...run.value,
        sources,
        steps,
        ...runState(steps),
        updatedAt: now,
      };
      return {
        run: yield* saveDocument("agent-workflow-run", value.id, value, expected),
        requiresReview: true,
      };
    }
    if (input.action === "save") {
      const prior = input.workflowId
        ? yield* ownedRecord<SocialWorkflow>("agent-workflow", input.workflowId, owner)
        : null;
      const value = yield* Effect.try({
        try: () => {
          if (!Array.isArray(input.steps) || !input.steps.length || input.steps.length > 30)
            throw invalid("Provide 1–30 preparation steps.");
          return {
            id: prior?.value.id ?? `${owner.key}:${randomUUID()}`,
            ownerKey: owner.key,
            name: text(input.name, "a workflow name", 160),
            archived: false,
            updatedAt: now,
            steps: input.steps.map((raw) => {
              const step = args(raw, ["tool", "label", "args"]);
              if (!PREPARATION_TOOLS.includes(step.tool as SocialPreparationTool))
                throw invalid(
                  "Workflows support preparation tools only; approval and publication cannot be saved.",
                );
              return {
                id: randomUUID(),
                tool: step.tool as SocialPreparationTool,
                label: text(step.label, "a step label", 200),
                args: dictionary(step.args ?? {}),
              };
            }),
          } satisfies SocialWorkflow;
        },
        catch: (e) => e as MarketingError,
      });
      return {
        workflow: yield* saveDocument(
          "agent-workflow",
          value.id,
          value,
          prior ? version(input.version) : null,
        ),
        requiresReview: true,
      };
    }
    const saved = yield* ownedRecord<SocialWorkflow>("agent-workflow", input.workflowId, owner);
    if (saved.version !== version(input.version))
      return yield* Effect.fail(
        new MarketingError("Workflow changed. Reload before continuing.", 409),
      );
    if (input.action === "archive")
      return {
        workflow: yield* saveDocument(
          "agent-workflow",
          saved.value.id,
          { ...saved.value, archived: true, updatedAt: now },
          saved.version,
        ),
        requiresReview: true,
      };
    if (input.action !== "run" || saved.value.archived)
      return yield* Effect.fail(invalid("Choose an available preparation workflow action."));
    const sources = sourceValues(input.sources);
    const steps: SocialWorkflowRun["steps"] = saved.value.steps.map((step) => {
      const missing = new Set<string>();
      const resolved = substitute(step.args, sources, missing) as Args;
      return {
        ...step,
        sourceArgs: step.args,
        args: resolved,
        status: missing.size ? "blocked" : "pending",
        reason: missing.size ? `Missing sources: ${[...missing].join(", ")}` : null,
        result: null,
      };
    });
    const value: SocialWorkflowRun = {
      id: `${owner.key}:${randomUUID()}`,
      ownerKey: owner.key,
      threadId: scope.threadId,
      workflowId: saved.value.id,
      workflowVersion: saved.version,
      name: saved.value.name,
      sources,
      steps,
      ...runState(steps),
      requiresReview: true,
      createdAt: now,
      updatedAt: now,
    };
    return {
      run: yield* saveDocument("agent-workflow-run", value.id, value, null),
      requiresReview: true,
    };
  });
}

interface Binding {
  apiBaseUrl: string;
  userId: string;
  orgId: string;
  campaignId: string;
  draftId: string;
  cloudRevision: number;
  campaignRevision: number;
}
type OwnedCampaign = {
  value: Campaign & { threadId: string; ownerKey?: string };
  version: number;
  bindings: Binding[];
};
function ownedCampaigns(owner: Owner) {
  return Effect.gen(function* () {
    const links = (yield* listDocuments("social-draft-link"))
      .map((r) => r.value as Binding)
      .filter(
        (link) =>
          link.apiBaseUrl === owner.apiBaseUrl &&
          link.userId === owner.userId &&
          link.orgId === owner.orgId,
      );
    return (yield* listDocuments("campaign")).flatMap((record): OwnedCampaign[] => {
      const value = record.value as OwnedCampaign["value"];
      if (!value.threadId) return [];
      const bindings = links.filter((link) => link.campaignId === value.id);
      return value.ownerKey === owner.key || (!value.ownerKey && bindings.length)
        ? [{ value, version: record.version, bindings }]
        : [];
    });
  });
}
function config(scope: MarketingToolScope) {
  return {
    stateDir: scope.stateDir,
    secretsDir: scope.secretsDir ?? path.join(scope.stateDir, "secrets"),
  };
}
function liveState(
  scope: MarketingToolScope,
  campaign: OwnedCampaign,
  owner: Owner,
  deps: Dependencies,
) {
  return Effect.gen(function* () {
    const result = yield* deps.bridge(config(scope), {
      action: "state",
      campaignId: campaign.value.id,
      threadId: campaign.value.threadId,
    });
    const state = result as { drafts: CloudSocialDraft[]; accounts: CloudSocialAccountsResponse };
    return {
      accounts: state.accounts,
      drafts: state.drafts.filter(
        (draft) =>
          draft.userId === owner.userId &&
          draft.orgId === owner.orgId &&
          draft.threadId === campaign.value.threadId &&
          campaign.bindings.some((link) => link.draftId === draft.id),
      ),
    };
  });
}
function inbox(scope: MarketingToolScope, input: Args, owner: Owner, deps: Dependencies) {
  return Effect.gen(function* () {
    const campaigns = yield* ownedCampaigns(owner);
    if (input.action !== "list") {
      const campaign = campaigns.find(
        (item) => item.value.id === input.campaignId && item.value.threadId === input.threadId,
      );
      if (!campaign)
        return yield* Effect.fail(
          new MarketingError("Campaign is missing or belongs to another account.", 404),
        );
      if (campaign.version !== version(input.version))
        return yield* Effect.fail(new MarketingError("Campaign changed. Reload the inbox.", 409));
      const state = yield* liveState(scope, campaign, owner, deps);
      const draft = state.drafts.find(
        (draft) => draft.id === input.draftId && draft.revision === input.revision,
      );
      if (!draft)
        return yield* Effect.fail(
          new MarketingError("Publishing preview changed. Reload the inbox.", 409),
        );
      const base = {
        campaignId: campaign.value.id,
        threadId: campaign.value.threadId,
        version: campaign.version,
        draftId: draft.id,
        revision: draft.revision,
      };
      if (
        input.taskId &&
        !draft.tasks.some((task) => task.id === input.taskId && task.revision === input.revision)
      )
        return yield* Effect.fail(
          new MarketingError("Publishing task changed. Reload the inbox.", 409),
        );
      if (input.action === "reschedule") {
        const scheduledAt = text(input.scheduledAt, "a future publication time");
        const timezone = text(input.timezone, "a timezone", 100);
        if (
          !Number.isFinite(Date.parse(scheduledAt)) ||
          Date.parse(scheduledAt) <= deps.now().getTime()
        )
          return yield* Effect.fail(invalid("Choose a valid future publication time."));
        yield* Effect.try({
          try: () => new Intl.DateTimeFormat("en", { timeZone: timezone }),
          catch: () => invalid("Choose a valid timezone."),
        });
        if (
          draft.tasks.some((task) =>
            ["publishing", "reconciling", "uncertain", "published"].includes(task.state),
          )
        )
          return yield* Effect.fail(
            new MarketingError(
              "Resolve processing results first; published posts cannot be rescheduled.",
              409,
            ),
          );
        if (
          campaign.bindings.find((link) => link.draftId === draft.id)?.campaignRevision !==
          campaign.value.revision
        )
          return yield* Effect.fail(
            new MarketingError(
              "Campaign changed since the preview. Prepare and review it again.",
              409,
            ),
          );
        const result = yield* deps.bridge(config(scope), {
          ...base,
          action: "prepare",
          accountIds: [...draft.content.accountIds],
          publicationMode: "scheduled",
          scheduledAt,
          timezone,
          ...(draft.content.tiktokOptions ? { tiktokOptions: draft.content.tiktokOptions } : {}),
        });
        return {
          draft: result,
          requiresReview: true,
          message:
            "New schedule prepared. Review the fresh preview and explicitly confirm it before publication.",
        };
      }
      const task = draft.tasks.find(
        (task) => task.id === input.taskId && task.revision === input.revision,
      );
      if (!task)
        return yield* Effect.fail(
          new MarketingError("Publishing task changed. Reload the inbox.", 409),
        );
      if (input.action !== "cancel" && input.action !== "retry")
        return yield* Effect.fail(invalid("Choose a valid inbox action."));
      return {
        task: yield* deps.bridge(config(scope), {
          ...base,
          action: "task",
          taskId: task.id,
          taskAction: input.action,
        }),
        retrievedAt: deps.now().toISOString(),
      };
    }
    const items: SocialInboxItem[] = [];
    const limitations: string[] = [];
    for (const campaign of campaigns) {
      const response = yield* liveState(scope, campaign, owner, deps).pipe(Effect.result);
      if (response._tag === "Failure") {
        limitations.push(
          `Live status unavailable for campaign ${campaign.value.id}. Retry after checking your connection.`,
        );
        continue;
      }
      const { drafts, accounts } = response.success;
      const issues: SocialInboxItem["issues"] = [];
      const upcoming: string[] = [];
      for (const draft of drafts) {
        if (!draft.confirmedAt)
          issues.push({ provider: null, taskId: null, code: "review_required" });
        for (const task of draft.tasks) {
          const provider =
            accounts.accounts.find((account) => account.id === task.accountId)?.provider ?? null;
          if (["failed", "uncertain", "reconciling"].includes(task.state))
            issues.push({ provider, taskId: task.id, code: task.errorCode ?? task.state });
          if (task.state === "queued") upcoming.push(task.dueAt);
        }
      }
      if (!drafts.length) issues.push({ provider: null, taskId: null, code: "prepare_preview" });
      items.push({
        campaignId: campaign.value.id,
        threadId: campaign.value.threadId,
        name: campaign.value.name,
        version: campaign.version,
        drafts,
        accounts: accounts.accounts.map(({ id, provider }) => ({ id, provider })),
        issues,
        nextScheduledAt: upcoming.toSorted()[0] ?? null,
      });
    }
    items.sort((a, b) => (a.nextScheduledAt ?? "z").localeCompare(b.nextScheduledAt ?? "z"));
    return {
      items,
      limitations,
      retrievedAt: deps.now().toISOString(),
    } satisfies SocialInboxResponse;
  });
}

const metricKeys = ["views", "likes", "comments", "shares"] as const;
function nullMetrics() {
  return { views: null, likes: null, comments: null, shares: null };
}
function officialMetrics(value: unknown): SocialCoachPost["metrics"] {
  const raw = value && typeof value === "object" ? (value as Args) : {};
  return Object.fromEntries(
    metricKeys.map((key) => [
      key,
      typeof raw[key] === "number" && Number.isFinite(raw[key]) && raw[key] >= 0 ? raw[key] : null,
    ]),
  ) as SocialCoachPost["metrics"];
}
function coach(scope: MarketingToolScope, input: Args, owner: Owner, deps: Dependencies) {
  return Effect.gen(function* () {
    const days = input.days ?? 30;
    if (!Number.isSafeInteger(days) || (days as number) < 1 || (days as number) > 90)
      return yield* Effect.fail(invalid("Choose a reporting period of 1–90 days."));
    const now = deps.now();
    const since = now.getTime() - (days as number) * 86400000;
    const posts: SocialCoachPost[] = [];
    const limitations = [
      "Publication dates use the published task updatedAt as a proxy; a provider publication timestamp is unavailable.",
      "Metrics are cumulative as returned now, not activity confined to this reporting period. Providers may update them later and define views differently.",
      "Provider averages use available values only; sample counts vary by metric. Missing metrics remain unavailable.",
    ];
    for (const campaign of yield* ownedCampaigns(owner)) {
      const result = yield* liveState(scope, campaign, owner, deps).pipe(Effect.result);
      if (result._tag === "Failure") {
        limitations.push(`Live results unavailable for campaign ${campaign.value.id}.`);
        continue;
      }
      for (const draft of result.success.drafts)
        for (const task of draft.tasks) {
          const publishedAt = Date.parse(task.updatedAt);
          if (
            task.state !== "published" ||
            !Number.isFinite(publishedAt) ||
            publishedAt < since ||
            publishedAt > now.getTime()
          )
            continue;
          const response = yield* deps
            .bridge(config(scope), {
              action: "metrics",
              campaignId: campaign.value.id,
              threadId: campaign.value.threadId,
              version: campaign.version,
              taskId: task.id,
              revision: task.revision,
            })
            .pipe(Effect.result);
          const body =
            response._tag === "Success" && response.success && typeof response.success === "object"
              ? (response.success as Args)
              : null;
          let postUrl: string | null = null;
          if (typeof body?.postUrl === "string") {
            try {
              const url = new URL(body.postUrl);
              if (url.protocol === "https:" && !url.username && !url.password) postUrl = url.href;
            } catch {
              /* Unavailable provider link. */
            }
          }
          posts.push({
            campaignId: campaign.value.id,
            threadId: campaign.value.threadId,
            draftId: draft.id,
            taskId: task.id,
            provider:
              result.success.accounts.accounts.find((account) => account.id === task.accountId)
                ?.provider ?? "unknown",
            accountId: task.accountId,
            publishedAt: task.updatedAt,
            publishedAtBasis: "task_updated_at",
            retrievedAt: deps.now().toISOString(),
            postUrl,
            metrics: body ? officialMetrics(body.metrics) : nullMetrics(),
            unavailableReason: body
              ? null
              : "Official metrics could not be retrieved. Reconnect the account or retry later.",
          });
        }
    }
    const providers: SocialCoachProvider[] = [...new Set(posts.map((post) => post.provider))].map(
      (provider) => {
        const selected = posts.filter((post) => post.provider === provider);
        const averages: { -readonly [K in keyof SocialCoachProvider["averages"]]: number | null } =
          nullMetrics();
        const availableSamples = { views: 0, likes: 0, comments: 0, shares: 0 };
        for (const key of metricKeys) {
          const values = selected.flatMap((post) =>
            post.metrics[key] === null ? [] : [post.metrics[key]!],
          );
          availableSamples[key] = values.length;
          averages[key] = values.length
            ? values.reduce((sum, value) => sum + value, 0) / values.length
            : null;
        }
        return { provider, publishedPosts: selected.length, averages, availableSamples };
      },
    );
    if (posts.length < 3)
      limitations.push(
        "Insufficient published-post samples to infer a content trend or best posting time. Publish and review more results first.",
      );
    if (
      posts.some(
        (post) => post.unavailableReason || metricKeys.some((key) => post.metrics[key] === null),
      )
    )
      limitations.push("Some official metrics are unavailable; comparisons are incomplete.");
    return {
      days,
      periodStart: new Date(since).toISOString(),
      retrievedAt: deps.now().toISOString(),
      posts,
      providers,
      limitations,
    };
  });
}

export function executeWorkflowTool(
  scope: MarketingToolScope,
  name: string,
  raw: unknown,
  deps: Dependencies = defaults,
): Effect.Effect<Record<string, unknown>, unknown, SqlClient.SqlClient> {
  return Effect.gen(function* () {
    const input = yield* Effect.try({
      try: () =>
        args(
          raw,
          name === "djl_social_workflows"
            ? [
                "action",
                "workflowId",
                "version",
                "name",
                "steps",
                "sources",
                "runId",
                "stepId",
                "status",
                "result",
                "reason",
              ]
            : name === "djl_social_inbox"
              ? [
                  "action",
                  "campaignId",
                  "threadId",
                  "version",
                  "draftId",
                  "taskId",
                  "revision",
                  "scheduledAt",
                  "timezone",
                ]
              : ["days"],
        ),
      catch: (e) => e as MarketingError,
    });
    const owner = yield* deps.owner(scope);
    // Catch synchronous input helpers as typed errors, not Effect defects.
    return yield* Effect.suspend<Record<string, unknown>, unknown, SqlClient.SqlClient>(() => {
      if (name === "djl_social_workflows") return workflow(scope, input, owner, deps);
      if (name === "djl_social_inbox") return inbox(scope, input, owner, deps);
      if (name === "djl_social_coach") return coach(scope, input, owner, deps);
      return Effect.fail(invalid("Unknown social workspace tool."));
    }).pipe(
      Effect.catchDefect((error) =>
        Effect.fail(
          error instanceof MarketingError ? error : invalid("Invalid social workspace input."),
        ),
      ),
    );
  });
}
