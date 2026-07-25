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
} from "@synara/contracts";

import type { ProviderAdapterError } from "../Errors.ts";
import type { ProviderAdapterShape } from "./ProviderAdapter.ts";

export interface OpenCodeAdapterShape extends ProviderAdapterShape<ProviderAdapterError> {
  readonly provider: "opencode";
  readonly listModelProviders: (
    input: OpenCodeListModelProvidersInput,
  ) => import("effect").Effect.Effect<OpenCodeListModelProvidersResult, ProviderAdapterError>;
  readonly setApiKey: (
    input: OpenCodeSetApiKeyInput,
  ) => import("effect").Effect.Effect<OpenCodeCredentialMutationResult, ProviderAdapterError>;
  readonly removeCredential: (
    input: OpenCodeRemoveCredentialInput,
  ) => import("effect").Effect.Effect<OpenCodeCredentialMutationResult, ProviderAdapterError>;
}

export class OpenCodeAdapter extends ServiceMap.Service<OpenCodeAdapter, OpenCodeAdapterShape>()(
  "synara/provider/Services/OpenCodeAdapter",
) {}
