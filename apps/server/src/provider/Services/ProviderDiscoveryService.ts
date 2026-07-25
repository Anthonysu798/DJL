import type {
  ProviderComposerCapabilities,
  ProviderGetComposerCapabilitiesInput,
  ProviderListAgentsInput,
  ProviderListAgentsResult,
  ProviderListCommandsInput,
  ProviderListCommandsResult,
  ProviderListModelsInput,
  ProviderListModelsResult,
  ProviderListPluginsInput,
  ProviderListPluginsResult,
  ProviderListSkillsInput,
  ProviderListSkillsResult,
  ProviderReadPluginInput,
  ProviderReadPluginResult,
  OpenCodeCredentialMutationResult,
  OpenCodeListModelProvidersInput,
  OpenCodeListModelProvidersResult,
  OpenCodeRemoveCredentialInput,
  OpenCodeSetApiKeyInput,
} from "@synara/contracts";
import { ServiceMap } from "effect";
import type { Effect } from "effect";

import type {
  ProviderAdapterError,
  ProviderUnsupportedError,
  ProviderValidationError,
} from "../Errors.ts";

export type ProviderDiscoveryError =
  | ProviderValidationError
  | ProviderUnsupportedError
  | ProviderAdapterError;

export interface ProviderDiscoveryServiceShape {
  readonly getComposerCapabilities: (
    input: ProviderGetComposerCapabilitiesInput,
  ) => Effect.Effect<ProviderComposerCapabilities, ProviderDiscoveryError>;
  readonly listCommands: (
    input: ProviderListCommandsInput,
  ) => Effect.Effect<ProviderListCommandsResult, ProviderDiscoveryError>;
  readonly listSkills: (
    input: ProviderListSkillsInput,
  ) => Effect.Effect<ProviderListSkillsResult, ProviderDiscoveryError>;
  readonly listPlugins: (
    input: ProviderListPluginsInput,
  ) => Effect.Effect<ProviderListPluginsResult, ProviderDiscoveryError>;
  readonly readPlugin: (
    input: ProviderReadPluginInput,
  ) => Effect.Effect<ProviderReadPluginResult, ProviderDiscoveryError>;
  readonly listModels: (
    input: ProviderListModelsInput,
  ) => Effect.Effect<ProviderListModelsResult, ProviderDiscoveryError>;
  readonly listAgents: (
    input: ProviderListAgentsInput,
  ) => Effect.Effect<ProviderListAgentsResult, ProviderDiscoveryError>;
  readonly listModelProviders: (
    input: OpenCodeListModelProvidersInput,
  ) => Effect.Effect<OpenCodeListModelProvidersResult, ProviderDiscoveryError>;
  readonly setApiKey: (
    input: OpenCodeSetApiKeyInput,
  ) => Effect.Effect<OpenCodeCredentialMutationResult, ProviderDiscoveryError>;
  readonly removeCredential: (
    input: OpenCodeRemoveCredentialInput,
  ) => Effect.Effect<OpenCodeCredentialMutationResult, ProviderDiscoveryError>;
}

export class ProviderDiscoveryService extends ServiceMap.Service<
  ProviderDiscoveryService,
  ProviderDiscoveryServiceShape
>()("synara/provider/Services/ProviderDiscoveryService") {}
