import { Effect } from "effect";
import { HttpRouter } from "effect/unstable/http";
import type { GatewayService } from "../gateway/GatewayService.ts";
import { json } from "../http/json.ts";
import type { CloudClientConfig } from "@synara/contracts/cloud";

export interface ClientConfigDeps {
  readonly auth: { readonly google: boolean; readonly apple: boolean };
  readonly gateway: Pick<GatewayService, "listModels">;
  readonly fileParsing: boolean;
  readonly pushConfigured: boolean;
  readonly policyUrls: { readonly terms: string | null; readonly privacy: string | null };
}

export function publicPolicyUrl(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

export async function clientConfig(deps: ClientConfigDeps): Promise<CloudClientConfig> {
  const models = await deps.gateway.listModels();
  const supports = (capability: string) =>
    models.some((model) => model.status === "active" && model.capabilities.includes(capability));
  return {
    auth: { google: deps.auth.google, apple: deps.auth.apple },
    tools: {
      imageGeneration: supports("image.generate"),
      imageEditing: supports("image.edit"),
      fileParsing: deps.fileParsing,
    },
    pushConfigured: deps.pushConfigured,
    policyUrls: {
      terms: publicPolicyUrl(deps.policyUrls.terms),
      privacy: publicPolicyUrl(deps.policyUrls.privacy),
    },
  };
}

export function makeClientConfigRoutes(deps: ClientConfigDeps) {
  return HttpRouter.add(
    "GET",
    "/v1/client-config",
    Effect.promise(async () => json(await clientConfig(deps))),
  );
}
