// FILE: codingPlans.ts
// Purpose: API-key coding plans that DJL runs through Claude Code on the provider's own
// Anthropic-compatible endpoint, plus the RPC schemas that connect and remove them.

import { Schema } from "effect";
import { TrimmedNonEmptyString } from "./baseSchemas";

export interface CodingPlanModel {
  /**
   * Model value Claude Code receives. Picker ids omit Claude Code's `[1m]` 1M-context marker
   * because DJL normalizes Claude slugs by stripping it; the documented tier env keeps it.
   */
  readonly id: string;
  readonly name: string;
}

export interface CodingPlanDefinition {
  /** Same ids OpenCode used, so a key already saved there can be imported. */
  readonly id: string;
  readonly name: string;
  readonly region: "international" | "china";
  /** Official page where a signed-in user creates or copies the plan key. */
  readonly keyUrl: string;
  /** Official Claude Code setup guide for this plan. */
  readonly docsUrl: string;
  readonly baseUrl: string;
  readonly authEnv: "ANTHROPIC_AUTH_TOKEN" | "ANTHROPIC_API_KEY";
  /** Extra env from the provider's Claude Code guide (model tiers, timeouts). */
  readonly extraEnv: Readonly<Record<string, string>>;
  readonly models: ReadonlyArray<CodingPlanModel>;
  /** How DJL checks a pasted key: list models, or a one-token message with `validationModel`. */
  readonly validation:
    | { readonly kind: "models" }
    | { readonly kind: "messages"; readonly validationModel: string };
}

// GLM Coding Plan, verified 2026-11-22 against https://docs.z.ai/devpack/tool/claude and
// https://docs.bigmodel.cn/cn/coding-plan/tool/claude (same env and models on both).
const GLM_ENV = {
  API_TIMEOUT_MS: "3000000",
  ANTHROPIC_DEFAULT_OPUS_MODEL: "glm-5.3[1m]",
  ANTHROPIC_DEFAULT_SONNET_MODEL: "glm-5.3[1m]",
  ANTHROPIC_DEFAULT_HAIKU_MODEL: "glm-5.3-flash[1m]",
} as const;
const GLM_MODELS: ReadonlyArray<CodingPlanModel> = [
  { id: "glm-5.3", name: "GLM-5.3" },
  { id: "glm-5.3-flash", name: "GLM-5.3-Flash" },
];

// Kimi For Coding, verified 2026-11-22 against
// https://www.kimi.com/code/docs/en/third-party-tools/claude-code.html and
// https://kimi.com/code/docs/en/ (regional endpoints). Kimi documents ANTHROPIC_API_KEY.
const KIMI_ENV = {
  ANTHROPIC_DEFAULT_FABLE_MODEL: "k3.1-pro",
  ANTHROPIC_DEFAULT_OPUS_MODEL: "k3.1-pro",
  ANTHROPIC_DEFAULT_SONNET_MODEL: "k3.1-pro",
  ANTHROPIC_DEFAULT_HAIKU_MODEL: "k3.1-pro",
  CLAUDE_CODE_SUBAGENT_MODEL: "k3.1-pro",
  // k3.1-pro serves 262,144 tokens; Claude Code would otherwise assume 1M for this model id.
  CLAUDE_CODE_MAX_CONTEXT_TOKENS: "262144",
  CLAUDE_CODE_AUTO_COMPACT_WINDOW: "262144",
} as const;
const KIMI_MODELS: ReadonlyArray<CodingPlanModel> = [{ id: "k3.1-pro", name: "Kimi K3.1 Pro" }];

// MiniMax Coding Plan, verified 2026-11-22 against
// https://platform.minimax.io/docs/m-plan/claude-code.md and
// https://platform.minimax.cn/docs/token-plan/claude-code (China moved to api.minimax.cn).
const MINIMAX_ENV = {
  ANTHROPIC_DEFAULT_OPUS_MODEL: "MiniMax-M3.1-Flash[1m]",
  ANTHROPIC_DEFAULT_SONNET_MODEL: "MiniMax-M3.1-Flash[1m]",
  ANTHROPIC_DEFAULT_HAIKU_MODEL: "MiniMax-M3.1-Flash[1m]",
  CLAUDE_CODE_AUTO_COMPACT_WINDOW: "524288",
} as const;
const MINIMAX_MODELS: ReadonlyArray<CodingPlanModel> = [
  { id: "MiniMax-M3.1-Flash", name: "MiniMax M3.1 Flash" },
];

export const CODING_PLANS: ReadonlyArray<CodingPlanDefinition> = [
  {
    id: "zai-coding-plan",
    name: "Z.AI Coding Plan",
    region: "international",
    keyUrl: "https://z.ai/manage-apikey/apikey-list",
    docsUrl: "https://docs.z.ai/devpack/tool/claude",
    baseUrl: "https://api.z.ai/api/anthropic",
    authEnv: "ANTHROPIC_AUTH_TOKEN",
    extraEnv: GLM_ENV,
    models: GLM_MODELS,
    // No documented cheap call; errors per https://docs.z.ai/api-reference/api-code
    validation: { kind: "messages", validationModel: "glm-5.3-flash" },
  },
  {
    id: "zhipuai-coding-plan",
    name: "Zhipu GLM Coding Plan",
    region: "china",
    keyUrl: "https://bigmodel.cn/apikey/coding-plan-per",
    docsUrl: "https://docs.bigmodel.cn/cn/coding-plan/tool/claude",
    baseUrl: "https://open.bigmodel.cn/api/anthropic",
    authEnv: "ANTHROPIC_AUTH_TOKEN",
    extraEnv: GLM_ENV,
    models: GLM_MODELS,
    validation: { kind: "messages", validationModel: "glm-5.3-flash" },
  },
  {
    id: "kimi-for-coding",
    name: "Kimi For Coding",
    region: "international",
    keyUrl: "https://www.kimi.com/code/console",
    docsUrl: "https://www.kimi.com/code/docs/en/third-party-tools/claude-code.html",
    baseUrl: "https://api.kimi.ai/coding/",
    authEnv: "ANTHROPIC_API_KEY",
    extraEnv: KIMI_ENV,
    models: KIMI_MODELS,
    // Errors per https://www.kimi.com/code/docs/en/kimi-code/error-reference.html
    validation: { kind: "messages", validationModel: "k3.1-pro" },
  },
  {
    id: "kimi-for-coding-cn",
    name: "Kimi For Coding",
    region: "china",
    keyUrl: "https://www.kimi.com/code/console",
    docsUrl: "https://www.kimi.com/code/docs/en/third-party-tools/claude-code.html",
    baseUrl: "https://api.kimi.com/coding/",
    authEnv: "ANTHROPIC_API_KEY",
    extraEnv: KIMI_ENV,
    models: KIMI_MODELS,
    validation: { kind: "messages", validationModel: "k3.1-pro" },
  },
  {
    id: "minimax-coding-plan",
    name: "MiniMax Coding Plan",
    region: "international",
    keyUrl: "https://platform.minimax.io/console/plan",
    docsUrl: "https://platform.minimax.io/docs/m-plan/claude-code.md",
    baseUrl: "https://api.minimax.io/anthropic",
    authEnv: "ANTHROPIC_AUTH_TOKEN",
    extraEnv: MINIMAX_ENV,
    models: MINIMAX_MODELS,
    // https://platform.minimax.io/docs/api-reference/models/anthropic/list-models.md
    validation: { kind: "models" },
  },
  {
    id: "minimax-cn-coding-plan",
    name: "MiniMax Coding Plan",
    region: "china",
    keyUrl: "https://platform.minimax.cn/console/plan",
    docsUrl: "https://platform.minimax.cn/docs/token-plan/claude-code",
    baseUrl: "https://api.minimax.cn/anthropic",
    authEnv: "ANTHROPIC_AUTH_TOKEN",
    extraEnv: MINIMAX_ENV,
    models: MINIMAX_MODELS,
    validation: { kind: "models" },
  },
];

export function findCodingPlan(planId: string): CodingPlanDefinition | undefined {
  return CODING_PLANS.find((plan) => plan.id === planId);
}

/** Model slug prefix that routes a Claude Code turn to a coding plan. */
export const CODING_PLAN_SLUG_PREFIX = "plan/";

export function codingPlanModelSlug(planId: string, modelId: string): string {
  return `${CODING_PLAN_SLUG_PREFIX}${planId}/${modelId}`;
}

const CodingPlanId = TrimmedNonEmptyString.check(
  Schema.isMaxLength(64),
  Schema.makeFilter((value) => findCodingPlan(value) !== undefined),
);

export const CodingPlanStatus = Schema.Struct({
  planId: TrimmedNonEmptyString,
  connected: Schema.Boolean,
  /** Last four characters of the saved key; the key itself never leaves the server. */
  keyHint: Schema.optional(Schema.String),
  /** OpenCode's auth file already holds an API key for this plan id. */
  openCodeKeyAvailable: Schema.Boolean,
});
export type CodingPlanStatus = typeof CodingPlanStatus.Type;
export const CodingPlansListResult = Schema.Struct({ plans: Schema.Array(CodingPlanStatus) });
export type CodingPlansListResult = typeof CodingPlansListResult.Type;

export const CodingPlanConnectInput = Schema.Struct({
  planId: CodingPlanId,
  apiKey: TrimmedNonEmptyString.check(Schema.isMaxLength(16_384)),
});
export type CodingPlanConnectInput = typeof CodingPlanConnectInput.Type;
export const CodingPlanIdInput = Schema.Struct({ planId: CodingPlanId });
export type CodingPlanIdInput = typeof CodingPlanIdInput.Type;

export const CodingPlanConnectError = Schema.Literals([
  "invalid_key",
  "plan_inactive",
  "network",
  "unknown",
  "no_opencode_key",
]);
export type CodingPlanConnectError = typeof CodingPlanConnectError.Type;
export const CodingPlanConnectResult = Schema.Struct({
  planId: TrimmedNonEmptyString,
  connected: Schema.Boolean,
  keyHint: Schema.optional(Schema.String),
  error: Schema.optional(CodingPlanConnectError),
});
export type CodingPlanConnectResult = typeof CodingPlanConnectResult.Type;
