/**
 * OpenCodeAdapter - OpenCode implementation of the generic provider adapter contract.
 *
 * This service owns OpenCode runtime/session semantics and emits canonical
 * provider runtime events. It does not perform cross-provider routing.
 *
 * @module OpenCodeAdapter
 */
import { ServiceMap } from "effect";
import type {
  OpenCodeCredentialMutationResult,
  OpenCodeListModelProvidersInput,
  OpenCodeListModelProvidersResult,
  OpenCodeRemoveCredentialInput,
  OpenCodeSetApiKeyInput,
  SaveCustomModelProviderInput,
  RemoveCustomModelProviderInput,
  FetchCustomModelsInput,
  FetchCustomModelsResult,
} from "@djl/contracts";

import type { ProviderAdapterError } from "../Errors.ts";
import type { ProviderAdapterShape } from "./ProviderAdapter.ts";

export interface OpenCodeAdapterShape extends ProviderAdapterShape<ProviderAdapterError> {
  readonly provider: "opencode";
  readonly listModelProviders: (
    input: OpenCodeListModelProvidersInput,
  ) => import("effect").Effect.Effect<OpenCodeListModelProvidersResult, ProviderAdapterError>;
  readonly saveCustomProvider?: (
    input: SaveCustomModelProviderInput,
  ) => import("effect").Effect.Effect<OpenCodeCredentialMutationResult, ProviderAdapterError>;
  readonly removeCustomProvider?: (
    input: RemoveCustomModelProviderInput,
  ) => import("effect").Effect.Effect<OpenCodeCredentialMutationResult, ProviderAdapterError>;
  readonly fetchCustomModels?: (
    input: FetchCustomModelsInput,
  ) => import("effect").Effect.Effect<FetchCustomModelsResult, ProviderAdapterError>;
  readonly setApiKey: (
    input: OpenCodeSetApiKeyInput,
  ) => import("effect").Effect.Effect<OpenCodeCredentialMutationResult, ProviderAdapterError>;
  readonly removeCredential: (
    input: OpenCodeRemoveCredentialInput,
  ) => import("effect").Effect.Effect<OpenCodeCredentialMutationResult, ProviderAdapterError>;
}

export class OpenCodeAdapter extends ServiceMap.Service<OpenCodeAdapter, OpenCodeAdapterShape>()(
  "djl/provider/Services/OpenCodeAdapter",
) {}
