import type {
  LocalInstalledModel,
  LocalModelRuntime,
  LocalModelRuntimeStatus,
  OpenCodeModelProviderConnection,
  ProviderKind,
  ServerProviderStatus,
} from "@synara/contracts";

import type { ProviderModelOption } from "../providerModelOptions";
import { isProviderUsable } from "./providerAvailability";

export type ZeroConfigModelOption = Pick<
  ProviderModelOption,
  "slug" | "processingLocality" | "upstreamProviderId"
>;

export interface ZeroConfigLocalModelsState {
  readonly runtimes: ReadonlyArray<Pick<LocalModelRuntimeStatus, "runtime" | "state">>;
  readonly installedModels: ReadonlyArray<Pick<LocalInstalledModel, "runtime" | "modelId">>;
}

export interface ZeroConfigCurrentSelection {
  readonly provider: ProviderKind;
  readonly modelSlug: string;
}

export interface ZeroConfigModelSelectionInput {
  /** The merged output from useProviderModelCatalog. */
  readonly modelOptionsByProvider: Partial<
    Record<ProviderKind, ReadonlyArray<ZeroConfigModelOption>>
  >;
  readonly providerStatuses: ReadonlyArray<ServerProviderStatus>;
  /** Authenticated upstream providers exposed by OpenCode discovery. */
  readonly openCodeProviders?:
    | ReadonlyArray<Pick<OpenCodeModelProviderConnection, "id" | "connected">>
    | undefined;
  /** A fresh snapshot or readLocalModelsBrowserCache()?.data. */
  readonly localModels?: ZeroConfigLocalModelsState | null | undefined;
  readonly currentSelection?: ZeroConfigCurrentSelection | null | undefined;
}

export type ZeroConfigNoModelReason =
  | "catalog-empty"
  | "local-model-not-installed"
  | "local-runtime-not-ready"
  | "no-connected-remote-model"
  | "no-usable-model";

export type ZeroConfigModelSelectionResult =
  | {
      readonly kind: "selected";
      readonly provider: ProviderKind;
      readonly modelSlug: string;
      readonly source: "current" | "remote" | "local";
    }
  | {
      readonly kind: "no-model";
      readonly reason: ZeroConfigNoModelReason;
    };

const PROVIDER_PRIORITY = [
  "codex",
  "claudeAgent",
  "cursor",
  "gemini",
  "opencode",
  "grok",
  "droid",
  "kilo",
  "pi",
] as const satisfies ReadonlyArray<ProviderKind>;

type LocalIdentity = {
  readonly runtime: LocalModelRuntime | null;
  readonly modelId: string | null;
};

type Candidate = {
  readonly provider: ProviderKind;
  readonly modelSlug: string;
  readonly providerRank: number;
  readonly catalogRank: number;
  readonly locality: "remote" | "local";
  readonly upstreamProviderId: string | null;
  readonly localIdentity: LocalIdentity | null;
};

function normalized(value: string): string {
  return value.trim().toLowerCase();
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function candidateKey(provider: ProviderKind, modelSlug: string): string {
  return `${provider}:${normalized(modelSlug)}`;
}

function localIdentityForOption(option: ZeroConfigModelOption): LocalIdentity | null {
  const slug = option.slug.trim();
  const slashIndex = slug.indexOf("/");
  const slugProvider = slashIndex > 0 ? normalized(slug.slice(0, slashIndex)) : null;
  const upstreamProvider = option.upstreamProviderId ? normalized(option.upstreamProviderId) : null;
  const runtime = [slugProvider, upstreamProvider].find(
    (value): value is LocalModelRuntime => value === "ollama" || value === "lmstudio",
  );

  if (runtime) {
    const modelId = slugProvider === runtime ? slug.slice(slashIndex + 1).trim() : slug;
    return { runtime, modelId: modelId.length > 0 ? modelId : null };
  }

  return option.processingLocality === "local" ? { runtime: null, modelId: null } : null;
}

function buildCandidates(input: ZeroConfigModelSelectionInput): Candidate[] {
  const candidates: Candidate[] = [];
  const seen = new Set<string>();

  for (const [providerRank, provider] of PROVIDER_PRIORITY.entries()) {
    const options = input.modelOptionsByProvider[provider] ?? [];
    for (const [catalogRank, option] of options.entries()) {
      const modelSlug = option.slug.trim();
      if (modelSlug.length === 0) continue;
      const key = candidateKey(provider, modelSlug);
      if (seen.has(key)) continue;
      seen.add(key);

      const localIdentity = localIdentityForOption(option);
      const slugProvider = normalized(modelSlug.split("/", 1)[0] ?? "");
      candidates.push({
        provider,
        modelSlug,
        providerRank,
        catalogRank,
        locality: localIdentity ? "local" : "remote",
        upstreamProviderId:
          option.upstreamProviderId?.trim() || (provider === "opencode" ? slugProvider : null),
        localIdentity,
      });
    }
  }

  const installedModels = input.localModels?.installedModels ?? [];
  for (const [installedRank, model] of installedModels.entries()) {
    const modelId = model.modelId.trim();
    if (modelId.length === 0) continue;
    const modelSlug = `${model.runtime}/${modelId}`;
    const key = candidateKey("opencode", modelSlug);
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({
      provider: "opencode",
      modelSlug,
      providerRank: PROVIDER_PRIORITY.indexOf("opencode"),
      catalogRank: Number.MAX_SAFE_INTEGER - installedModels.length + installedRank,
      locality: "local",
      upstreamProviderId: model.runtime,
      localIdentity: { runtime: model.runtime, modelId },
    });
  }

  return candidates;
}

function compareCandidates(left: Candidate, right: Candidate): number {
  return (
    left.providerRank - right.providerRank ||
    left.catalogRank - right.catalogRank ||
    compareText(normalized(left.modelSlug), normalized(right.modelSlug))
  );
}

function providerIsReady(
  provider: ProviderKind,
  statuses: ReadonlyArray<ServerProviderStatus>,
): boolean {
  return isProviderUsable(statuses.find((status) => status.provider === provider));
}

function remoteCandidateIsReady(
  candidate: Candidate,
  input: ZeroConfigModelSelectionInput,
): boolean {
  if (!providerIsReady(candidate.provider, input.providerStatuses)) return false;
  if (candidate.provider !== "opencode") return true;

  const upstreamProviderId = candidate.upstreamProviderId
    ? normalized(candidate.upstreamProviderId)
    : null;
  return (
    upstreamProviderId !== null &&
    (input.openCodeProviders ?? []).some(
      (provider) => provider.connected && normalized(provider.id) === upstreamProviderId,
    )
  );
}

function localModelIsInstalled(
  candidate: Candidate,
  localModels: ZeroConfigLocalModelsState | null | undefined,
): boolean {
  const identity = candidate.localIdentity;
  const runtime = identity?.runtime;
  const modelId = identity?.modelId;
  if (!runtime || !modelId) return false;
  return (localModels?.installedModels ?? []).some(
    (model) => model.runtime === runtime && normalized(model.modelId) === normalized(modelId),
  );
}

function localRuntimeIsReady(
  candidate: Candidate,
  localModels: ZeroConfigLocalModelsState | null | undefined,
): boolean {
  const runtime = candidate.localIdentity?.runtime;
  if (!runtime) return false;
  return (
    localModels?.runtimes.some(
      (status) => status.runtime === runtime && status.state === "running",
    ) === true
  );
}

function localCandidateIsReady(
  candidate: Candidate,
  input: ZeroConfigModelSelectionInput,
): boolean {
  return (
    providerIsReady(candidate.provider, input.providerStatuses) &&
    localModelIsInstalled(candidate, input.localModels) &&
    localRuntimeIsReady(candidate, input.localModels)
  );
}

function candidateIsReady(candidate: Candidate, input: ZeroConfigModelSelectionInput): boolean {
  return candidate.locality === "local"
    ? localCandidateIsReady(candidate, input)
    : remoteCandidateIsReady(candidate, input);
}

function noModelReason(
  candidates: ReadonlyArray<Candidate>,
  input: ZeroConfigModelSelectionInput,
): ZeroConfigNoModelReason {
  if (candidates.length === 0) return "catalog-empty";

  const localCandidates = candidates.filter((candidate) => candidate.locality === "local");
  const installedLocalCandidates = localCandidates.filter((candidate) =>
    localModelIsInstalled(candidate, input.localModels),
  );
  if (
    installedLocalCandidates.some((candidate) => !localRuntimeIsReady(candidate, input.localModels))
  ) {
    return "local-runtime-not-ready";
  }

  const remoteCandidates = candidates.filter((candidate) => candidate.locality === "remote");
  if (remoteCandidates.length > 0) return "no-connected-remote-model";
  if (localCandidates.length > 0 && installedLocalCandidates.length === 0) {
    return "local-model-not-installed";
  }
  return "no-usable-model";
}

/**
 * Selects a zero-configuration model without treating catalog presence as availability.
 * Priority is: healthy current selection, connected remote model, then installed/running local
 * model. Ties use the fixed provider order above and the upstream catalog order.
 */
export function selectZeroConfigModel(
  input: ZeroConfigModelSelectionInput,
): ZeroConfigModelSelectionResult {
  const candidates = buildCandidates(input);
  const currentSelection = input.currentSelection;

  if (currentSelection) {
    const currentCandidate = candidates.find(
      (candidate) =>
        candidate.provider === currentSelection.provider &&
        normalized(candidate.modelSlug) === normalized(currentSelection.modelSlug),
    );
    if (currentCandidate && candidateIsReady(currentCandidate, input)) {
      return {
        kind: "selected",
        provider: currentCandidate.provider,
        modelSlug: currentCandidate.modelSlug,
        source: "current",
      };
    }
  }

  const remoteCandidate = candidates
    .filter(
      (candidate) => candidate.locality === "remote" && remoteCandidateIsReady(candidate, input),
    )
    .toSorted(compareCandidates)[0];
  if (remoteCandidate) {
    return {
      kind: "selected",
      provider: remoteCandidate.provider,
      modelSlug: remoteCandidate.modelSlug,
      source: "remote",
    };
  }

  const localCandidate = candidates
    .filter(
      (candidate) => candidate.locality === "local" && localCandidateIsReady(candidate, input),
    )
    .toSorted(compareCandidates)[0];
  if (localCandidate) {
    return {
      kind: "selected",
      provider: localCandidate.provider,
      modelSlug: localCandidate.modelSlug,
      source: "local",
    };
  }

  return { kind: "no-model", reason: noModelReason(candidates, input) };
}
