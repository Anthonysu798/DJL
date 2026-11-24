// FILE: validateKey.ts
// Purpose: One cheap authenticated request against a coding plan's own Anthropic-compatible
// endpoint, mapped to a user-facing outcome. The key is never logged or echoed.

import type { CodingPlanConnectError, CodingPlanDefinition } from "@djl/contracts";

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export type CodingPlanKeyCheck = "ok" | Exclude<CodingPlanConnectError, "no_opencode_key">;

// Provider business codes meaning "key is real but the plan cannot be used":
// Z.AI/Zhipu 1113 insufficient balance (https://docs.z.ai/api-reference/api-code),
// MiniMax 2057 not a plan key (https://platform.minimax.io/docs/api-reference/errorcode.md).
const PLAN_INACTIVE_CODES = new Set([1113, 2057]);
// Z.AI 1000/1001/1003 and MiniMax 1004/2049 are authentication failures.
const INVALID_KEY_CODES = new Set([1000, 1001, 1003, 1004, 2049]);

function endpoint(plan: CodingPlanDefinition, path: string): string {
  const base = plan.baseUrl.endsWith("/") ? plan.baseUrl : `${plan.baseUrl}/`;
  return new URL(path, base).toString();
}

function businessCodes(body: unknown): number[] {
  if (!body || typeof body !== "object") return [];
  const record = body as Record<string, unknown>;
  const nested = [record.error, record.base_resp, record];
  return nested.flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const fields = value as Record<string, unknown>;
    return [fields.code, fields.status_code]
      .map((code) => (typeof code === "string" ? Number(code) : code))
      .filter((code): code is number => typeof code === "number" && Number.isFinite(code));
  });
}

export async function validateCodingPlanKey(
  plan: CodingPlanDefinition,
  apiKey: string,
  options: { readonly fetch?: FetchLike; readonly timeoutMs?: number } = {},
): Promise<CodingPlanKeyCheck> {
  const fetchImpl: FetchLike = options.fetch ?? ((url, init) => fetch(url, init));
  const headers = {
    // Send both styles: Claude Code uses Bearer for ANTHROPIC_AUTH_TOKEN and x-api-key for
    // ANTHROPIC_API_KEY, and each provider documents one of them.
    authorization: `Bearer ${apiKey}`,
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
    "content-type": "application/json",
  };
  let response: Response;
  try {
    response = await fetchImpl(
      plan.validation.kind === "models"
        ? endpoint(plan, "v1/models")
        : endpoint(plan, "v1/messages"),
      {
        method: plan.validation.kind === "models" ? "GET" : "POST",
        headers,
        ...(plan.validation.kind === "messages"
          ? {
              body: JSON.stringify({
                model: plan.validation.validationModel,
                max_tokens: 1,
                messages: [{ role: "user", content: "ping" }],
              }),
            }
          : {}),
        signal: AbortSignal.timeout(options.timeoutMs ?? 20_000),
      },
    );
  } catch {
    return "network";
  }
  const body: unknown = await response.json().catch(() => null);
  const codes = businessCodes(body);
  if (codes.some((code) => PLAN_INACTIVE_CODES.has(code)) || response.status === 402)
    return "plan_inactive";
  if (codes.some((code) => INVALID_KEY_CODES.has(code))) return "invalid_key";
  if (response.status === 401 || response.status === 403) return "invalid_key";
  if (response.status >= 500) return "network";
  // 2xx, or 400/429 after the key was accepted (a model or rate limit complaint).
  if (response.ok || response.status === 400 || response.status === 429) return "ok";
  return "unknown";
}
