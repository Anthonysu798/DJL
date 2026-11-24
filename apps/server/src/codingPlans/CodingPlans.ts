// FILE: CodingPlans.ts
// Purpose: Connect, list, and remove API-key coding plans. Keys live only in DJL's secret
// store (0600 files under the server secrets dir); OpenCode's auth file is read, never written.

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import {
  CODING_PLANS,
  type CodingPlanConnectInput,
  type CodingPlanConnectResult,
  type CodingPlanIdInput,
  type CodingPlansListResult,
  type ProviderModelDescriptor,
  codingPlanModelSlug,
  findCodingPlan,
} from "@djl/contracts";
import { Effect, Layer, ServiceMap } from "effect";

import { ServerSecretStore, type ServerSecretStoreShape } from "../auth/Services/ServerSecretStore";
import { resolveOpenCodeAuthFilePath } from "../provider/opencodeRuntime";
import { type FetchLike, validateCodingPlanKey } from "./validateKey";

export const codingPlanSecretName = (planId: string) => `codingPlan.${planId}.apiKey`;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const keyHint = (key: string) => key.slice(-4);

/** API key OpenCode saved for this provider id, if any. Read-only. */
export async function readOpenCodePlanKey(
  planId: string,
  authFilePath: string = resolveOpenCodeAuthFilePath({ home: homedir() }),
): Promise<string | null> {
  const raw = await readFile(authFilePath, "utf8").catch(() => null);
  if (!raw) return null;
  try {
    const entry = (JSON.parse(raw) as Record<string, unknown>)[planId];
    if (!entry || typeof entry !== "object") return null;
    const { type, key } = entry as { type?: unknown; key?: unknown };
    return type === "api" && typeof key === "string" && key.trim() ? key.trim() : null;
  } catch {
    return null;
  }
}

export interface CodingPlansShape {
  readonly list: Effect.Effect<CodingPlansListResult, Error>;
  readonly connect: (
    input: CodingPlanConnectInput,
  ) => Effect.Effect<CodingPlanConnectResult, Error>;
  readonly disconnect: (input: CodingPlanIdInput) => Effect.Effect<CodingPlanConnectResult, Error>;
  readonly importFromOpenCode: (
    input: CodingPlanIdInput,
  ) => Effect.Effect<CodingPlanConnectResult, Error>;
  /** Saved key for a plan, or null. Only the Claude driver reads this. */
  readonly readKey: (planId: string) => Promise<string | null>;
  /** Picker entries for every connected plan, routed to Claude Code. */
  readonly connectedModels: () => Promise<ProviderModelDescriptor[]>;
}

export class CodingPlans extends ServiceMap.Service<CodingPlans, CodingPlansShape>()(
  "djl/codingPlans/CodingPlans",
) {}

export interface CodingPlansOptions {
  readonly fetch?: FetchLike;
  readonly openCodeAuthFilePath?: string;
}

export function makeCodingPlans(
  store: ServerSecretStoreShape,
  options: CodingPlansOptions = {},
): CodingPlansShape {
  const readKey = async (planId: string) => {
    const bytes = await Effect.runPromise(store.get(codingPlanSecretName(planId)));
    return bytes ? decoder.decode(bytes) : null;
  };
  const save = async (planId: string, apiKey: string): Promise<CodingPlanConnectResult> => {
    const plan = findCodingPlan(planId);
    if (!plan) throw new Error(`Unknown coding plan: ${planId}`);
    const check = await validateCodingPlanKey(
      plan,
      apiKey,
      options.fetch ? { fetch: options.fetch } : {},
    );
    if (check !== "ok") return { planId, connected: false, error: check };
    await Effect.runPromise(store.set(codingPlanSecretName(planId), encoder.encode(apiKey)));
    return { planId, connected: true, keyHint: keyHint(apiKey) };
  };
  const promise = <A>(run: () => Promise<A>) =>
    Effect.tryPromise({
      try: run,
      catch: (cause) => (cause instanceof Error ? cause : new Error("Coding plan request failed")),
    });
  return {
    list: promise(async () => ({
      plans: await Promise.all(
        CODING_PLANS.map(async (plan) => {
          const key = await readKey(plan.id);
          return {
            planId: plan.id,
            connected: key !== null,
            ...(key ? { keyHint: keyHint(key) } : {}),
            openCodeKeyAvailable:
              (await readOpenCodePlanKey(plan.id, options.openCodeAuthFilePath)) !== null,
          };
        }),
      ),
    })),
    connect: (input) => promise(() => save(input.planId, input.apiKey.trim())),
    disconnect: (input) =>
      promise(async () => {
        await Effect.runPromise(store.remove(codingPlanSecretName(input.planId)));
        return { planId: input.planId, connected: false };
      }),
    importFromOpenCode: (input) =>
      promise(async () => {
        const key = await readOpenCodePlanKey(input.planId, options.openCodeAuthFilePath);
        if (!key) return { planId: input.planId, connected: false, error: "no_opencode_key" };
        return save(input.planId, key);
      }),
    readKey,
    connectedModels: async () => {
      const models: ProviderModelDescriptor[] = [];
      for (const plan of CODING_PLANS) {
        if ((await readKey(plan.id)) === null) continue;
        const group =
          CODING_PLANS.filter((candidate) => candidate.name === plan.name).length > 1
            ? `${plan.name} (${plan.region === "china" ? "China" : "International"})`
            : plan.name;
        for (const model of plan.models)
          models.push({
            slug: codingPlanModelSlug(plan.id, model.id),
            name: model.name,
            upstreamProviderId: plan.id,
            upstreamProviderName: group,
            supportsToolCalls: true,
          });
      }
      return models;
    },
  };
}

export const CodingPlansLive = Layer.effect(
  CodingPlans,
  Effect.gen(function* () {
    return makeCodingPlans(yield* ServerSecretStore);
  }),
);
