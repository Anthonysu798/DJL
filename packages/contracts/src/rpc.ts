import { Schema } from "effect";
import * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";
import { CommandId } from "./baseSchemas";

import {
  AutomationCancelRunInput,
  AutomationCancelRunResult,
  AutomationArchiveRunInput,
  AutomationCreateInput,
  AutomationDefinition,
  AutomationDeleteInput,
  AutomationListInput,
  AutomationListResult,
  AutomationMarkRunReadInput,
  AutomationRunActionResult,
  AutomationRunNowInput,
  AutomationRunNowResult,
  AutomationStreamEvent,
  AutomationUpdateInput,
} from "./automation";
import { OpenInEditorInput } from "./editor";
import { FilesystemBrowseInput, FilesystemBrowseResult } from "./filesystem";
import { StudioListThreadOutputsInput, StudioListThreadOutputsResult } from "./studio";
import {
  DocumentRenderEvent,
  DocumentRendererStatus,
  DocumentIntelligenceStatus,
  WorkCancelDocumentRenderInput,
  WorkCancelDocumentRenderResult,
  WorkGetDocumentRenderInput,
  WorkGetDocumentRenderResult,
  WorkListPreparedDocumentsInput,
  WorkListPreparedDocumentsResult,
  WorkPreviewDocumentInput,
  WorkPreviewDocumentResult,
  WorkRequestDocumentRenderInput,
  WorkRequestDocumentRenderResult,
  WorkResolveArtifactPathInput,
  WorkResolveArtifactPathResult,
} from "./document";
import {
  GitCheckoutInput,
  GitActionProgressEvent,
  GitCreateBranchInput,
  GitCreateDetachedWorktreeInput,
  GitCreateDetachedWorktreeResult,
  GitCreateWorktreeInput,
  GitCreateWorktreeResult,
  GitHubRepositoryInput,
  GitHubRepositoryResult,
  GitHandoffThreadInput,
  GitHandoffThreadResult,
  GitInitInput,
  GitListBranchesInput,
  GitListBranchesResult,
  GitPreparePullRequestThreadInput,
  GitPreparePullRequestThreadResult,
  GitPullInput,
  GitPullRequestRefInput,
  GitPullRequestSnapshotInput,
  GitPullRequestSnapshotResult,
  GitPullResult,
  GitReadWorkingTreeDiffInput,
  GitReadWorkingTreeDiffResult,
  GitRemoveIndexLockInput,
  GitRemoveWorktreeInput,
  GitResolvePullRequestResult,
  GitRunStackedActionInput,
  GitStageFilesInput,
  GitStageFilesResult,
  GitStashAndCheckoutInput,
  GitStashDropInput,
  GitStashInfoInput,
  GitStashInfoResult,
  GitStatusInput,
  GitStatusResult,
  GitSummarizeDiffInput,
  GitSummarizeDiffResult,
  GitUnstageFilesInput,
  GitUnstageFilesResult,
} from "./git";
import { KeybindingRule } from "./keybindings";
import {
  ClientOrchestrationCommand,
  ORCHESTRATION_WS_METHODS,
  OrchestrationEvent,
  OrchestrationImportThreadInput,
  OrchestrationImportThreadResult,
  OrchestrationRpcSchemas,
  OrchestrationShellStreamItem,
  OrchestrationSubscribeDomainEventsInput,
  OrchestrationThreadStreamItem,
  ProjectMemoryDeleteInput,
  ProjectMemoryItem,
  ProjectMemoryListInput,
  ProjectMemoryListResult,
  ProjectMemoryRenameInput,
  ProjectMemorySaveInput,
} from "./orchestration";
import { ProviderCompactThreadInput } from "./provider";
import {
  ProviderGetComposerCapabilitiesInput,
  ProviderComposerCapabilities,
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
  ProviderSkillsCatalogInput,
  ProviderSkillsCatalogResult,
  ProviderReadPluginInput,
  ProviderReadPluginResult,
  OpenCodeCredentialMutationResult,
  OpenCodeListModelProvidersInput,
  OpenCodeListModelProvidersResult,
  OpenCodeRemoveCredentialInput,
  OpenCodeSetApiKeyInput,
} from "./providerDiscovery";
import {
  ProjectCreateLocalFilePreviewGrantInput,
  ProjectCreateLocalFilePreviewGrantResult,
  ProjectDevServerEvent,
  ProjectDiscoverScriptsInput,
  ProjectDiscoverScriptsResult,
  ProjectListDevServersResult,
  ProjectListDirectoriesInput,
  ProjectListDirectoriesResult,
  ProjectReadFileInput,
  ProjectReadFileResult,
  ProjectRunDevServerInput,
  ProjectRunDevServerResult,
  ProjectSearchEntriesInput,
  ProjectSearchEntriesResult,
  ProjectSearchLocalEntriesInput,
  ProjectSearchLocalEntriesResult,
  ProjectStopDevServerInput,
  ProjectStopDevServerResult,
  ProjectWriteFileInput,
  ProjectWriteFileResult,
} from "./project";
import {
  ServerConfig,
  ServerConfigStreamEvent,
  ServerDiagnosticsResult,
  ServerGenerateAutomationIntentInput,
  ServerGenerateAutomationIntentResult,
  ServerGenerateThreadRecapInput,
  ServerGenerateThreadRecapResult,
  ServerGetEnvironmentResult,
  ServerGetProviderUsageSnapshotInput,
  ServerGetProviderUsageSnapshotResult,
  ServerListProviderUsageInput,
  ServerListProviderUsageResult,
  ServerLifecycleStreamEvent,
  ServerGetSettingsResult,
  ServerListLocalServersResult,
  ServerListWorktreesResult,
  ServerProviderUpdateError,
  ServerProviderUpdateInput,
  ServerProviderUpdateResult,
  ServerRefreshProvidersResult,
  ServerStopLocalServerInput,
  ServerStopLocalServerResult,
  ServerUpdateSettingsInput,
  ServerUpdateSettingsResult,
  ServerUpsertKeybindingResult,
  ServerVoiceTranscriptionInput,
  ServerVoiceTranscriptionResult,
} from "./server";
import {
  TerminalAckOutputInput,
  TerminalClearInput,
  TerminalCloseInput,
  TerminalEvent,
  TerminalOpenInput,
  TerminalResizeInput,
  TerminalRestartInput,
  TerminalSessionSnapshot,
  TerminalWriteInput,
} from "./terminal";
import {
  StatsGetProfileStatsInput,
  StatsGetProfileStatsResult,
  StatsGetProfileTokenStatsInput,
  StatsGetProfileTokenStatsResult,
} from "./stats";
import { WS_METHODS } from "./ws";
import {
  LocalModelCancelInstallInput,
  LocalModelCapabilityCheckInput,
  LocalModelEvent,
  LocalModelInstallInput,
  LocalModelInstallJob,
  LocalModelRemoveInput,
  LocalModelRuntimeInput,
  LocalModelSetupInput,
  LocalModelSetupJob,
  LocalModelSetupJobInput,
  LocalModelsSnapshot,
} from "./localModels";
import {
  AiDetectorCancelInstallInput,
  AiDetectorEvent,
  AiDetectorInstallModelInput,
  AiDetectorRemoveModelInput,
  AiDetectorState,
} from "./aiDetector";

export class WsRpcError extends Schema.TaggedErrorClass<WsRpcError>()("WsRpcError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect),
  commandId: Schema.optional(CommandId),
  status: Schema.optional(Schema.Literal("failed")),
}) {}

export const WsOrchestrationDispatchCommandRpc = Rpc.make(
  ORCHESTRATION_WS_METHODS.dispatchCommand,
  {
    payload: ClientOrchestrationCommand,
    success: OrchestrationRpcSchemas.dispatchCommand.output,
    error: WsRpcError,
  },
);

export const WsOrchestrationImportThreadRpc = Rpc.make(ORCHESTRATION_WS_METHODS.importThread, {
  payload: OrchestrationImportThreadInput,
  success: OrchestrationImportThreadResult,
  error: WsRpcError,
});

export const WsOrchestrationGetSnapshotRpc = Rpc.make(ORCHESTRATION_WS_METHODS.getSnapshot, {
  payload: OrchestrationRpcSchemas.getSnapshot.input,
  success: OrchestrationRpcSchemas.getSnapshot.output,
  error: WsRpcError,
});

export const WsOrchestrationGetShellSnapshotRpc = Rpc.make(
  ORCHESTRATION_WS_METHODS.getShellSnapshot,
  {
    payload: OrchestrationRpcSchemas.getShellSnapshot.input,
    success: OrchestrationRpcSchemas.getShellSnapshot.output,
    error: WsRpcError,
  },
);

export const WsOrchestrationRepairStateRpc = Rpc.make(ORCHESTRATION_WS_METHODS.repairState, {
  payload: OrchestrationRpcSchemas.repairState.input,
  success: OrchestrationRpcSchemas.repairState.output,
  error: WsRpcError,
});

export const WsOrchestrationGetTurnDiffRpc = Rpc.make(ORCHESTRATION_WS_METHODS.getTurnDiff, {
  payload: OrchestrationRpcSchemas.getTurnDiff.input,
  success: OrchestrationRpcSchemas.getTurnDiff.output,
  error: WsRpcError,
});

export const WsOrchestrationGetFullThreadDiffRpc = Rpc.make(
  ORCHESTRATION_WS_METHODS.getFullThreadDiff,
  {
    payload: OrchestrationRpcSchemas.getFullThreadDiff.input,
    success: OrchestrationRpcSchemas.getFullThreadDiff.output,
    error: WsRpcError,
  },
);

export const WsOrchestrationReplayEventsRpc = Rpc.make(ORCHESTRATION_WS_METHODS.replayEvents, {
  payload: OrchestrationRpcSchemas.replayEvents.input,
  success: OrchestrationRpcSchemas.replayEvents.output,
  error: WsRpcError,
});

export const WsOrchestrationSubscribeShellRpc = Rpc.make(ORCHESTRATION_WS_METHODS.subscribeShell, {
  payload: OrchestrationRpcSchemas.subscribeShell.input,
  success: OrchestrationShellStreamItem,
  error: WsRpcError,
  stream: true,
});

export const WsOrchestrationUnsubscribeShellRpc = Rpc.make(
  ORCHESTRATION_WS_METHODS.unsubscribeShell,
  {
    payload: OrchestrationRpcSchemas.unsubscribeShell.input,
    success: Schema.Void,
    error: WsRpcError,
  },
);

export const WsOrchestrationSubscribeThreadRpc = Rpc.make(
  ORCHESTRATION_WS_METHODS.subscribeThread,
  {
    payload: OrchestrationRpcSchemas.subscribeThread.input,
    success: OrchestrationThreadStreamItem,
    error: WsRpcError,
    stream: true,
  },
);

export const WsOrchestrationSubscribeDomainEventsRpc = Rpc.make(
  WS_METHODS.subscribeOrchestrationDomainEvents,
  {
    payload: OrchestrationSubscribeDomainEventsInput,
    success: OrchestrationEvent,
    error: WsRpcError,
    stream: true,
  },
);

export const WsOrchestrationUnsubscribeThreadRpc = Rpc.make(
  ORCHESTRATION_WS_METHODS.unsubscribeThread,
  {
    payload: OrchestrationRpcSchemas.unsubscribeThread.input,
    success: Schema.Void,
    error: WsRpcError,
  },
);

export const WsProjectsListDirectoriesRpc = Rpc.make(WS_METHODS.projectsListDirectories, {
  payload: ProjectListDirectoriesInput,
  success: ProjectListDirectoriesResult,
  error: WsRpcError,
});

export const WsProjectsDiscoverScriptsRpc = Rpc.make(WS_METHODS.projectsDiscoverScripts, {
  payload: ProjectDiscoverScriptsInput,
  success: ProjectDiscoverScriptsResult,
  error: WsRpcError,
});

export const WsProjectsSearchEntriesRpc = Rpc.make(WS_METHODS.projectsSearchEntries, {
  payload: ProjectSearchEntriesInput,
  success: ProjectSearchEntriesResult,
  error: WsRpcError,
});

export const WsProjectsSearchLocalEntriesRpc = Rpc.make(WS_METHODS.projectsSearchLocalEntries, {
  payload: ProjectSearchLocalEntriesInput,
  success: ProjectSearchLocalEntriesResult,
  error: WsRpcError,
});

export const WsProjectsReadFileRpc = Rpc.make(WS_METHODS.projectsReadFile, {
  payload: ProjectReadFileInput,
  success: ProjectReadFileResult,
  error: WsRpcError,
});

export const WsProjectsCreateLocalFilePreviewGrantRpc = Rpc.make(
  WS_METHODS.projectsCreateLocalFilePreviewGrant,
  {
    payload: ProjectCreateLocalFilePreviewGrantInput,
    success: ProjectCreateLocalFilePreviewGrantResult,
    error: WsRpcError,
  },
);

export const WsProjectsWriteFileRpc = Rpc.make(WS_METHODS.projectsWriteFile, {
  payload: ProjectWriteFileInput,
  success: ProjectWriteFileResult,
  error: WsRpcError,
});

export const WsProjectsRunDevServerRpc = Rpc.make(WS_METHODS.projectsRunDevServer, {
  payload: ProjectRunDevServerInput,
  success: ProjectRunDevServerResult,
  error: WsRpcError,
});

export const WsProjectsStopDevServerRpc = Rpc.make(WS_METHODS.projectsStopDevServer, {
  payload: ProjectStopDevServerInput,
  success: ProjectStopDevServerResult,
  error: WsRpcError,
});

export const WsProjectsListDevServersRpc = Rpc.make(WS_METHODS.projectsListDevServers, {
  payload: Schema.Struct({}),
  success: ProjectListDevServersResult,
  error: WsRpcError,
});

export const WsSubscribeProjectDevServerEventsRpc = Rpc.make(
  WS_METHODS.subscribeProjectDevServerEvents,
  {
    payload: Schema.Struct({}),
    success: ProjectDevServerEvent,
    error: WsRpcError,
    stream: true,
  },
);

export const WsStudioListThreadOutputsRpc = Rpc.make(WS_METHODS.studioListThreadOutputs, {
  payload: StudioListThreadOutputsInput,
  success: StudioListThreadOutputsResult,
  error: WsRpcError,
});

export const WsWorkDocumentIntelligenceStatusRpc = Rpc.make(
  WS_METHODS.workDocumentIntelligenceStatus,
  {
    payload: Schema.Struct({}),
    success: DocumentIntelligenceStatus,
    error: WsRpcError,
  },
);

export const WsWorkDocumentIntelligenceInstallRpc = Rpc.make(
  WS_METHODS.workDocumentIntelligenceInstall,
  {
    payload: Schema.Struct({}),
    success: DocumentIntelligenceStatus,
    error: WsRpcError,
  },
);

export const WsWorkDocumentIntelligenceRepairRpc = Rpc.make(
  WS_METHODS.workDocumentIntelligenceRepair,
  {
    payload: Schema.Struct({}),
    success: DocumentIntelligenceStatus,
    error: WsRpcError,
  },
);

export const WsWorkDocumentIntelligenceUninstallRpc = Rpc.make(
  WS_METHODS.workDocumentIntelligenceUninstall,
  {
    payload: Schema.Struct({}),
    success: Schema.Void,
    error: WsRpcError,
  },
);

export const WsWorkListPreparedDocumentsRpc = Rpc.make(WS_METHODS.workListPreparedDocuments, {
  payload: WorkListPreparedDocumentsInput,
  success: WorkListPreparedDocumentsResult,
  error: WsRpcError,
});

export const WsWorkPreviewDocumentRpc = Rpc.make(WS_METHODS.workPreviewDocument, {
  payload: WorkPreviewDocumentInput,
  success: WorkPreviewDocumentResult,
  error: WsRpcError,
});

export const WsWorkResolveArtifactPathRpc = Rpc.make(WS_METHODS.workResolveArtifactPath, {
  payload: WorkResolveArtifactPathInput,
  success: WorkResolveArtifactPathResult,
  error: WsRpcError,
});

export const WsWorkDocumentRendererStatusRpc = Rpc.make(WS_METHODS.workDocumentRendererStatus, {
  payload: Schema.Struct({}),
  success: DocumentRendererStatus,
  error: WsRpcError,
});

export const WsWorkDocumentRendererInstallRpc = Rpc.make(WS_METHODS.workDocumentRendererInstall, {
  payload: Schema.Struct({}),
  success: DocumentRendererStatus,
  error: WsRpcError,
});

export const WsWorkDocumentRendererRepairRpc = Rpc.make(WS_METHODS.workDocumentRendererRepair, {
  payload: Schema.Struct({}),
  success: DocumentRendererStatus,
  error: WsRpcError,
});

export const WsWorkDocumentRendererUninstallRpc = Rpc.make(
  WS_METHODS.workDocumentRendererUninstall,
  { payload: Schema.Struct({}), success: Schema.Void, error: WsRpcError },
);

export const WsWorkRequestDocumentRenderRpc = Rpc.make(WS_METHODS.workRequestDocumentRender, {
  payload: WorkRequestDocumentRenderInput,
  success: WorkRequestDocumentRenderResult,
  error: WsRpcError,
});

export const WsWorkGetDocumentRenderRpc = Rpc.make(WS_METHODS.workGetDocumentRender, {
  payload: WorkGetDocumentRenderInput,
  success: WorkGetDocumentRenderResult,
  error: WsRpcError,
});

export const WsWorkCancelDocumentRenderRpc = Rpc.make(WS_METHODS.workCancelDocumentRender, {
  payload: WorkCancelDocumentRenderInput,
  success: WorkCancelDocumentRenderResult,
  error: WsRpcError,
});

export const WsSubscribeWorkDocumentRenderEventsRpc = Rpc.make(
  WS_METHODS.subscribeWorkDocumentRenderEvents,
  {
    payload: Schema.Struct({}),
    success: DocumentRenderEvent,
    error: WsRpcError,
    stream: true,
  },
);

export const WsLocalModelsGetSnapshotRpc = Rpc.make(WS_METHODS.localModelsGetSnapshot, {
  payload: Schema.Struct({}),
  success: LocalModelsSnapshot,
  error: WsRpcError,
});

export const WsLocalModelsRefreshRpc = Rpc.make(WS_METHODS.localModelsRefresh, {
  payload: Schema.Struct({}),
  success: LocalModelsSnapshot,
  error: WsRpcError,
});

export const WsLocalModelsInstallRuntimeRpc = Rpc.make(WS_METHODS.localModelsInstallRuntime, {
  payload: LocalModelRuntimeInput,
  success: LocalModelsSnapshot,
  error: WsRpcError,
});

export const WsLocalModelsStartRuntimeRpc = Rpc.make(WS_METHODS.localModelsStartRuntime, {
  payload: LocalModelRuntimeInput,
  success: LocalModelsSnapshot,
  error: WsRpcError,
});

export const WsLocalModelsInstallModelRpc = Rpc.make(WS_METHODS.localModelsInstallModel, {
  payload: LocalModelInstallInput,
  success: LocalModelInstallJob,
  error: WsRpcError,
});

export const WsLocalModelsCancelInstallRpc = Rpc.make(WS_METHODS.localModelsCancelInstall, {
  payload: LocalModelCancelInstallInput,
  success: LocalModelInstallJob,
  error: WsRpcError,
});

export const WsLocalModelsStartSetupRpc = Rpc.make(WS_METHODS.localModelsStartSetup, {
  payload: LocalModelSetupInput,
  success: LocalModelSetupJob,
  error: WsRpcError,
});

export const WsLocalModelsRetrySetupRpc = Rpc.make(WS_METHODS.localModelsRetrySetup, {
  payload: LocalModelSetupJobInput,
  success: LocalModelSetupJob,
  error: WsRpcError,
});

export const WsLocalModelsCancelSetupRpc = Rpc.make(WS_METHODS.localModelsCancelSetup, {
  payload: LocalModelSetupJobInput,
  success: LocalModelSetupJob,
  error: WsRpcError,
});

export const WsLocalModelsRemoveModelRpc = Rpc.make(WS_METHODS.localModelsRemoveModel, {
  payload: LocalModelRemoveInput,
  success: LocalModelsSnapshot,
  error: WsRpcError,
});

export const WsLocalModelsRerunCapabilityCheckRpc = Rpc.make(
  WS_METHODS.localModelsRerunCapabilityCheck,
  {
    payload: LocalModelCapabilityCheckInput,
    success: LocalModelsSnapshot,
    error: WsRpcError,
  },
);

export const WsSubscribeLocalModelEventsRpc = Rpc.make(WS_METHODS.subscribeLocalModelEvents, {
  payload: Schema.Struct({}),
  success: LocalModelEvent,
  error: WsRpcError,
  stream: true,
});

export const WsProjectMemoryListRpc = Rpc.make(WS_METHODS.projectMemoryList, {
  payload: ProjectMemoryListInput,
  success: ProjectMemoryListResult,
  error: WsRpcError,
});

export const WsProjectMemorySaveRpc = Rpc.make(WS_METHODS.projectMemorySave, {
  payload: ProjectMemorySaveInput,
  success: ProjectMemoryItem,
  error: WsRpcError,
});

export const WsProjectMemoryRenameRpc = Rpc.make(WS_METHODS.projectMemoryRename, {
  payload: ProjectMemoryRenameInput,
  success: ProjectMemoryItem,
  error: WsRpcError,
});

export const WsProjectMemoryDeleteRpc = Rpc.make(WS_METHODS.projectMemoryDelete, {
  payload: ProjectMemoryDeleteInput,
  success: Schema.Void,
  error: WsRpcError,
});

export const WsAiDetectorGetStateRpc = Rpc.make(WS_METHODS.aiDetectorGetState, {
  payload: Schema.Struct({}),
  success: AiDetectorState,
  error: WsRpcError,
});

export const WsAiDetectorInstallModelRpc = Rpc.make(WS_METHODS.aiDetectorInstallModel, {
  payload: AiDetectorInstallModelInput,
  success: AiDetectorState,
  error: WsRpcError,
});

export const WsAiDetectorCancelInstallRpc = Rpc.make(WS_METHODS.aiDetectorCancelInstall, {
  payload: AiDetectorCancelInstallInput,
  success: AiDetectorState,
  error: WsRpcError,
});

export const WsAiDetectorRemoveModelRpc = Rpc.make(WS_METHODS.aiDetectorRemoveModel, {
  payload: AiDetectorRemoveModelInput,
  success: AiDetectorState,
  error: WsRpcError,
});

export const WsAiDetectorClearCacheRpc = Rpc.make(WS_METHODS.aiDetectorClearCache, {
  payload: Schema.Struct({}),
  success: AiDetectorState,
  error: WsRpcError,
});

export const WsSubscribeAiDetectorEventsRpc = Rpc.make(WS_METHODS.subscribeAiDetectorEvents, {
  payload: Schema.Struct({}),
  success: AiDetectorEvent,
  error: WsRpcError,
  stream: true,
});

export const WsFilesystemBrowseRpc = Rpc.make(WS_METHODS.filesystemBrowse, {
  payload: FilesystemBrowseInput,
  success: FilesystemBrowseResult,
  error: WsRpcError,
});

export const WsShellOpenInEditorRpc = Rpc.make(WS_METHODS.shellOpenInEditor, {
  payload: OpenInEditorInput,
  success: Schema.Void,
  error: WsRpcError,
});

export const WsGitStatusRpc = Rpc.make(WS_METHODS.gitStatus, {
  payload: GitStatusInput,
  success: GitStatusResult,
  error: WsRpcError,
});

export const WsGitGithubRepositoryRpc = Rpc.make(WS_METHODS.gitGithubRepository, {
  payload: GitHubRepositoryInput,
  success: GitHubRepositoryResult,
  error: WsRpcError,
});

export const WsGitReadWorkingTreeDiffRpc = Rpc.make(WS_METHODS.gitReadWorkingTreeDiff, {
  payload: GitReadWorkingTreeDiffInput,
  success: GitReadWorkingTreeDiffResult,
  error: WsRpcError,
});

export const WsGitSummarizeDiffRpc = Rpc.make(WS_METHODS.gitSummarizeDiff, {
  payload: GitSummarizeDiffInput,
  success: GitSummarizeDiffResult,
  error: WsRpcError,
});

export const WsGitPullRpc = Rpc.make(WS_METHODS.gitPull, {
  payload: GitPullInput,
  success: GitPullResult,
  error: WsRpcError,
});

export const WsGitRunStackedActionRpc = Rpc.make(WS_METHODS.gitRunStackedAction, {
  payload: GitRunStackedActionInput,
  success: GitActionProgressEvent,
  error: WsRpcError,
  stream: true,
});

export const WsGitResolvePullRequestRpc = Rpc.make(WS_METHODS.gitResolvePullRequest, {
  payload: GitPullRequestRefInput,
  success: GitResolvePullRequestResult,
  error: WsRpcError,
});

export const WsGitPullRequestSnapshotRpc = Rpc.make(WS_METHODS.gitPullRequestSnapshot, {
  payload: GitPullRequestSnapshotInput,
  success: GitPullRequestSnapshotResult,
  error: WsRpcError,
});

export const WsGitPreparePullRequestThreadRpc = Rpc.make(WS_METHODS.gitPreparePullRequestThread, {
  payload: GitPreparePullRequestThreadInput,
  success: GitPreparePullRequestThreadResult,
  error: WsRpcError,
});

export const WsGitListBranchesRpc = Rpc.make(WS_METHODS.gitListBranches, {
  payload: GitListBranchesInput,
  success: GitListBranchesResult,
  error: WsRpcError,
});

export const WsGitCreateWorktreeRpc = Rpc.make(WS_METHODS.gitCreateWorktree, {
  payload: GitCreateWorktreeInput,
  success: GitCreateWorktreeResult,
  error: WsRpcError,
});

export const WsGitCreateDetachedWorktreeRpc = Rpc.make(WS_METHODS.gitCreateDetachedWorktree, {
  payload: GitCreateDetachedWorktreeInput,
  success: GitCreateDetachedWorktreeResult,
  error: WsRpcError,
});

export const WsGitRemoveWorktreeRpc = Rpc.make(WS_METHODS.gitRemoveWorktree, {
  payload: GitRemoveWorktreeInput,
  success: Schema.Void,
  error: WsRpcError,
});

export const WsGitCreateBranchRpc = Rpc.make(WS_METHODS.gitCreateBranch, {
  payload: GitCreateBranchInput,
  success: Schema.Void,
  error: WsRpcError,
});

export const WsGitCheckoutRpc = Rpc.make(WS_METHODS.gitCheckout, {
  payload: GitCheckoutInput,
  success: Schema.Void,
  error: WsRpcError,
});

export const WsGitStashAndCheckoutRpc = Rpc.make(WS_METHODS.gitStashAndCheckout, {
  payload: GitStashAndCheckoutInput,
  success: Schema.Void,
  error: WsRpcError,
});

export const WsGitStashDropRpc = Rpc.make(WS_METHODS.gitStashDrop, {
  payload: GitStashDropInput,
  success: Schema.Void,
  error: WsRpcError,
});

export const WsGitStashInfoRpc = Rpc.make(WS_METHODS.gitStashInfo, {
  payload: GitStashInfoInput,
  success: GitStashInfoResult,
  error: WsRpcError,
});

export const WsGitRemoveIndexLockRpc = Rpc.make(WS_METHODS.gitRemoveIndexLock, {
  payload: GitRemoveIndexLockInput,
  success: Schema.Void,
  error: WsRpcError,
});

export const WsGitInitRpc = Rpc.make(WS_METHODS.gitInit, {
  payload: GitInitInput,
  success: Schema.Void,
  error: WsRpcError,
});

export const WsGitStageFilesRpc = Rpc.make(WS_METHODS.gitStageFiles, {
  payload: GitStageFilesInput,
  success: GitStageFilesResult,
  error: WsRpcError,
});

export const WsGitUnstageFilesRpc = Rpc.make(WS_METHODS.gitUnstageFiles, {
  payload: GitUnstageFilesInput,
  success: GitUnstageFilesResult,
  error: WsRpcError,
});

export const WsGitHandoffThreadRpc = Rpc.make(WS_METHODS.gitHandoffThread, {
  payload: GitHandoffThreadInput,
  success: GitHandoffThreadResult,
  error: WsRpcError,
});

export const WsTerminalOpenRpc = Rpc.make(WS_METHODS.terminalOpen, {
  payload: TerminalOpenInput,
  success: TerminalSessionSnapshot,
  error: WsRpcError,
});

export const WsTerminalWriteRpc = Rpc.make(WS_METHODS.terminalWrite, {
  payload: TerminalWriteInput,
  success: Schema.Void,
  error: WsRpcError,
});

export const WsTerminalAckOutputRpc = Rpc.make(WS_METHODS.terminalAckOutput, {
  payload: TerminalAckOutputInput,
  success: Schema.Void,
  error: WsRpcError,
});

export const WsTerminalResizeRpc = Rpc.make(WS_METHODS.terminalResize, {
  payload: TerminalResizeInput,
  success: Schema.Void,
  error: WsRpcError,
});

export const WsTerminalClearRpc = Rpc.make(WS_METHODS.terminalClear, {
  payload: TerminalClearInput,
  success: Schema.Void,
  error: WsRpcError,
});

export const WsTerminalRestartRpc = Rpc.make(WS_METHODS.terminalRestart, {
  payload: TerminalRestartInput,
  success: TerminalSessionSnapshot,
  error: WsRpcError,
});

export const WsTerminalCloseRpc = Rpc.make(WS_METHODS.terminalClose, {
  payload: TerminalCloseInput,
  success: Schema.Void,
  error: WsRpcError,
});

export const WsSubscribeTerminalEventsRpc = Rpc.make(WS_METHODS.subscribeTerminalEvents, {
  payload: Schema.Struct({}),
  success: TerminalEvent,
  error: WsRpcError,
  stream: true,
});

export const WsServerGetConfigRpc = Rpc.make(WS_METHODS.serverGetConfig, {
  payload: Schema.Struct({}),
  success: ServerConfig,
  error: WsRpcError,
});

export const WsServerGetEnvironmentRpc = Rpc.make(WS_METHODS.serverGetEnvironment, {
  payload: Schema.Struct({}),
  success: ServerGetEnvironmentResult,
  error: WsRpcError,
});

export const WsServerGetSettingsRpc = Rpc.make(WS_METHODS.serverGetSettings, {
  payload: Schema.Struct({}),
  success: ServerGetSettingsResult,
  error: WsRpcError,
});

export const WsServerUpdateSettingsRpc = Rpc.make(WS_METHODS.serverUpdateSettings, {
  payload: ServerUpdateSettingsInput,
  success: ServerUpdateSettingsResult,
  error: WsRpcError,
});

export const WsServerRefreshProvidersRpc = Rpc.make(WS_METHODS.serverRefreshProviders, {
  payload: Schema.Struct({}),
  success: ServerRefreshProvidersResult,
  error: WsRpcError,
});

export const WsServerUpdateProviderRpc = Rpc.make(WS_METHODS.serverUpdateProvider, {
  payload: ServerProviderUpdateInput,
  success: ServerProviderUpdateResult,
  error: ServerProviderUpdateError,
});

export const WsServerListWorktreesRpc = Rpc.make(WS_METHODS.serverListWorktrees, {
  payload: Schema.Struct({}),
  success: ServerListWorktreesResult,
  error: WsRpcError,
});

export const WsServerListLocalServersRpc = Rpc.make(WS_METHODS.serverListLocalServers, {
  payload: Schema.Struct({}),
  success: ServerListLocalServersResult,
  error: WsRpcError,
});

export const WsServerStopLocalServerRpc = Rpc.make(WS_METHODS.serverStopLocalServer, {
  payload: ServerStopLocalServerInput,
  success: ServerStopLocalServerResult,
  error: WsRpcError,
});

export const WsServerGetProviderUsageSnapshotRpc = Rpc.make(
  WS_METHODS.serverGetProviderUsageSnapshot,
  {
    payload: ServerGetProviderUsageSnapshotInput,
    success: ServerGetProviderUsageSnapshotResult,
    error: WsRpcError,
  },
);

export const WsServerListProviderUsageRpc = Rpc.make(WS_METHODS.serverListProviderUsage, {
  payload: ServerListProviderUsageInput,
  success: ServerListProviderUsageResult,
  error: WsRpcError,
});

export const WsStatsGetProfileStatsRpc = Rpc.make(WS_METHODS.statsGetProfileStats, {
  payload: StatsGetProfileStatsInput,
  success: StatsGetProfileStatsResult,
  error: WsRpcError,
});

export const WsStatsGetProfileTokenStatsRpc = Rpc.make(WS_METHODS.statsGetProfileTokenStats, {
  payload: StatsGetProfileTokenStatsInput,
  success: StatsGetProfileTokenStatsResult,
  error: WsRpcError,
});

export const WsServerGetDiagnosticsRpc = Rpc.make(WS_METHODS.serverGetDiagnostics, {
  payload: Schema.Struct({}),
  success: ServerDiagnosticsResult,
  error: WsRpcError,
});

export const WsServerTranscribeVoiceRpc = Rpc.make(WS_METHODS.serverTranscribeVoice, {
  payload: ServerVoiceTranscriptionInput,
  success: ServerVoiceTranscriptionResult,
  error: WsRpcError,
});

export const WsServerGenerateThreadRecapRpc = Rpc.make(WS_METHODS.serverGenerateThreadRecap, {
  payload: ServerGenerateThreadRecapInput,
  success: ServerGenerateThreadRecapResult,
  error: WsRpcError,
});

export const WsServerGenerateAutomationIntentRpc = Rpc.make(
  WS_METHODS.serverGenerateAutomationIntent,
  {
    payload: ServerGenerateAutomationIntentInput,
    success: ServerGenerateAutomationIntentResult,
    error: WsRpcError,
  },
);

export const WsServerUpsertKeybindingRpc = Rpc.make(WS_METHODS.serverUpsertKeybinding, {
  payload: KeybindingRule,
  success: ServerUpsertKeybindingResult,
  error: WsRpcError,
});

export const WsSubscribeServerLifecycleRpc = Rpc.make(WS_METHODS.subscribeServerLifecycle, {
  payload: Schema.Struct({}),
  success: ServerLifecycleStreamEvent,
  error: WsRpcError,
  stream: true,
});

export const WsSubscribeServerConfigRpc = Rpc.make(WS_METHODS.subscribeServerConfig, {
  payload: Schema.Struct({}),
  success: ServerConfigStreamEvent,
  error: WsRpcError,
  stream: true,
});

export const WsSubscribeServerProviderStatusesRpc = Rpc.make(
  WS_METHODS.subscribeServerProviderStatuses,
  {
    payload: Schema.Struct({}),
    success: ServerRefreshProvidersResult,
    error: WsRpcError,
    stream: true,
  },
);

export const WsSubscribeServerSettingsRpc = Rpc.make(WS_METHODS.subscribeServerSettings, {
  payload: Schema.Struct({}),
  success: Schema.Struct({ settings: ServerGetSettingsResult }),
  error: WsRpcError,
  stream: true,
});

export const WsProviderGetComposerCapabilitiesRpc = Rpc.make(
  WS_METHODS.providerGetComposerCapabilities,
  {
    payload: ProviderGetComposerCapabilitiesInput,
    success: ProviderComposerCapabilities,
    error: WsRpcError,
  },
);

export const WsProviderCompactThreadRpc = Rpc.make(WS_METHODS.providerCompactThread, {
  payload: ProviderCompactThreadInput,
  success: Schema.Void,
  error: WsRpcError,
});

export const WsProviderListCommandsRpc = Rpc.make(WS_METHODS.providerListCommands, {
  payload: ProviderListCommandsInput,
  success: ProviderListCommandsResult,
  error: WsRpcError,
});

export const WsProviderListSkillsRpc = Rpc.make(WS_METHODS.providerListSkills, {
  payload: ProviderListSkillsInput,
  success: ProviderListSkillsResult,
  error: WsRpcError,
});

export const WsProviderListSkillsCatalogRpc = Rpc.make(WS_METHODS.providerListSkillsCatalog, {
  payload: ProviderSkillsCatalogInput,
  success: ProviderSkillsCatalogResult,
  error: WsRpcError,
});

export const WsProviderListPluginsRpc = Rpc.make(WS_METHODS.providerListPlugins, {
  payload: ProviderListPluginsInput,
  success: ProviderListPluginsResult,
  error: WsRpcError,
});

export const WsProviderReadPluginRpc = Rpc.make(WS_METHODS.providerReadPlugin, {
  payload: ProviderReadPluginInput,
  success: ProviderReadPluginResult,
  error: WsRpcError,
});

export const WsProviderListModelsRpc = Rpc.make(WS_METHODS.providerListModels, {
  payload: ProviderListModelsInput,
  success: ProviderListModelsResult,
  error: WsRpcError,
});

export const WsProviderListAgentsRpc = Rpc.make(WS_METHODS.providerListAgents, {
  payload: ProviderListAgentsInput,
  success: ProviderListAgentsResult,
  error: WsRpcError,
});

export const WsOpenCodeListModelProvidersRpc = Rpc.make(WS_METHODS.openCodeListModelProviders, {
  payload: OpenCodeListModelProvidersInput,
  success: OpenCodeListModelProvidersResult,
  error: WsRpcError,
});

export const WsOpenCodeSetApiKeyRpc = Rpc.make(WS_METHODS.openCodeSetApiKey, {
  payload: OpenCodeSetApiKeyInput,
  success: OpenCodeCredentialMutationResult,
  error: WsRpcError,
});

export const WsOpenCodeRemoveCredentialRpc = Rpc.make(WS_METHODS.openCodeRemoveCredential, {
  payload: OpenCodeRemoveCredentialInput,
  success: OpenCodeCredentialMutationResult,
  error: WsRpcError,
});

export const WsAutomationListRpc = Rpc.make(WS_METHODS.automationList, {
  payload: AutomationListInput,
  success: AutomationListResult,
  error: WsRpcError,
});

export const WsAutomationCreateRpc = Rpc.make(WS_METHODS.automationCreate, {
  payload: AutomationCreateInput,
  success: AutomationDefinition,
  error: WsRpcError,
});

export const WsAutomationUpdateRpc = Rpc.make(WS_METHODS.automationUpdate, {
  payload: AutomationUpdateInput,
  success: AutomationDefinition,
  error: WsRpcError,
});

export const WsAutomationDeleteRpc = Rpc.make(WS_METHODS.automationDelete, {
  payload: AutomationDeleteInput,
  success: Schema.Void,
  error: WsRpcError,
});

export const WsAutomationRunNowRpc = Rpc.make(WS_METHODS.automationRunNow, {
  payload: AutomationRunNowInput,
  success: AutomationRunNowResult,
  error: WsRpcError,
});

export const WsAutomationCancelRunRpc = Rpc.make(WS_METHODS.automationCancelRun, {
  payload: AutomationCancelRunInput,
  success: AutomationCancelRunResult,
  error: WsRpcError,
});

export const WsAutomationMarkRunReadRpc = Rpc.make(WS_METHODS.automationMarkRunRead, {
  payload: AutomationMarkRunReadInput,
  success: AutomationRunActionResult,
  error: WsRpcError,
});

export const WsAutomationArchiveRunRpc = Rpc.make(WS_METHODS.automationArchiveRun, {
  payload: AutomationArchiveRunInput,
  success: AutomationRunActionResult,
  error: WsRpcError,
});

export const WsSubscribeAutomationEventsRpc = Rpc.make(WS_METHODS.subscribeAutomationEvents, {
  payload: Schema.Struct({}),
  success: AutomationStreamEvent,
  error: WsRpcError,
  stream: true,
});

export const WsRpcGroup = RpcGroup.make(
  WsOrchestrationDispatchCommandRpc,
  WsOrchestrationImportThreadRpc,
  WsOrchestrationGetSnapshotRpc,
  WsOrchestrationGetShellSnapshotRpc,
  WsOrchestrationRepairStateRpc,
  WsOrchestrationGetTurnDiffRpc,
  WsOrchestrationGetFullThreadDiffRpc,
  WsOrchestrationReplayEventsRpc,
  WsOrchestrationSubscribeShellRpc,
  WsOrchestrationUnsubscribeShellRpc,
  WsOrchestrationSubscribeThreadRpc,
  WsOrchestrationUnsubscribeThreadRpc,
  WsOrchestrationSubscribeDomainEventsRpc,
  WsProjectsDiscoverScriptsRpc,
  WsProjectsListDirectoriesRpc,
  WsProjectsSearchEntriesRpc,
  WsProjectsSearchLocalEntriesRpc,
  WsProjectsReadFileRpc,
  WsProjectsCreateLocalFilePreviewGrantRpc,
  WsProjectsWriteFileRpc,
  WsProjectsRunDevServerRpc,
  WsProjectsStopDevServerRpc,
  WsProjectsListDevServersRpc,
  WsSubscribeProjectDevServerEventsRpc,
  WsStudioListThreadOutputsRpc,
  WsWorkDocumentIntelligenceStatusRpc,
  WsWorkDocumentIntelligenceInstallRpc,
  WsWorkDocumentIntelligenceRepairRpc,
  WsWorkDocumentIntelligenceUninstallRpc,
  WsWorkListPreparedDocumentsRpc,
  WsWorkPreviewDocumentRpc,
  WsWorkResolveArtifactPathRpc,
  WsWorkDocumentRendererStatusRpc,
  WsWorkDocumentRendererInstallRpc,
  WsWorkDocumentRendererRepairRpc,
  WsWorkDocumentRendererUninstallRpc,
  WsWorkRequestDocumentRenderRpc,
  WsWorkGetDocumentRenderRpc,
  WsWorkCancelDocumentRenderRpc,
  WsSubscribeWorkDocumentRenderEventsRpc,
  WsLocalModelsGetSnapshotRpc,
  WsLocalModelsRefreshRpc,
  WsLocalModelsInstallRuntimeRpc,
  WsLocalModelsStartRuntimeRpc,
  WsLocalModelsInstallModelRpc,
  WsLocalModelsCancelInstallRpc,
  WsLocalModelsStartSetupRpc,
  WsLocalModelsRetrySetupRpc,
  WsLocalModelsCancelSetupRpc,
  WsLocalModelsRerunCapabilityCheckRpc,
  WsLocalModelsRemoveModelRpc,
  WsSubscribeLocalModelEventsRpc,
  WsProjectMemoryListRpc,
  WsProjectMemorySaveRpc,
  WsProjectMemoryRenameRpc,
  WsProjectMemoryDeleteRpc,
  WsAiDetectorGetStateRpc,
  WsAiDetectorInstallModelRpc,
  WsAiDetectorCancelInstallRpc,
  WsAiDetectorRemoveModelRpc,
  WsAiDetectorClearCacheRpc,
  WsSubscribeAiDetectorEventsRpc,
  WsFilesystemBrowseRpc,
  WsShellOpenInEditorRpc,
  WsGitGithubRepositoryRpc,
  WsGitStatusRpc,
  WsGitReadWorkingTreeDiffRpc,
  WsGitSummarizeDiffRpc,
  WsGitPullRpc,
  WsGitRunStackedActionRpc,
  WsGitResolvePullRequestRpc,
  WsGitPullRequestSnapshotRpc,
  WsGitPreparePullRequestThreadRpc,
  WsGitListBranchesRpc,
  WsGitCreateWorktreeRpc,
  WsGitCreateDetachedWorktreeRpc,
  WsGitRemoveWorktreeRpc,
  WsGitCreateBranchRpc,
  WsGitCheckoutRpc,
  WsGitStashAndCheckoutRpc,
  WsGitStashDropRpc,
  WsGitStashInfoRpc,
  WsGitRemoveIndexLockRpc,
  WsGitInitRpc,
  WsGitStageFilesRpc,
  WsGitUnstageFilesRpc,
  WsGitHandoffThreadRpc,
  WsTerminalOpenRpc,
  WsTerminalWriteRpc,
  WsTerminalAckOutputRpc,
  WsTerminalResizeRpc,
  WsTerminalClearRpc,
  WsTerminalRestartRpc,
  WsTerminalCloseRpc,
  WsSubscribeTerminalEventsRpc,
  WsServerGetConfigRpc,
  WsServerGetEnvironmentRpc,
  WsServerGetSettingsRpc,
  WsServerUpdateSettingsRpc,
  WsServerRefreshProvidersRpc,
  WsServerUpdateProviderRpc,
  WsServerListWorktreesRpc,
  WsServerListLocalServersRpc,
  WsServerStopLocalServerRpc,
  WsServerGetProviderUsageSnapshotRpc,
  WsServerListProviderUsageRpc,
  WsStatsGetProfileStatsRpc,
  WsStatsGetProfileTokenStatsRpc,
  WsServerGetDiagnosticsRpc,
  WsServerTranscribeVoiceRpc,
  WsServerGenerateThreadRecapRpc,
  WsServerGenerateAutomationIntentRpc,
  WsServerUpsertKeybindingRpc,
  WsSubscribeServerLifecycleRpc,
  WsSubscribeServerConfigRpc,
  WsSubscribeServerProviderStatusesRpc,
  WsSubscribeServerSettingsRpc,
  WsProviderGetComposerCapabilitiesRpc,
  WsProviderCompactThreadRpc,
  WsProviderListCommandsRpc,
  WsProviderListSkillsRpc,
  WsProviderListSkillsCatalogRpc,
  WsProviderListPluginsRpc,
  WsProviderReadPluginRpc,
  WsProviderListModelsRpc,
  WsOpenCodeListModelProvidersRpc,
  WsOpenCodeSetApiKeyRpc,
  WsOpenCodeRemoveCredentialRpc,
  WsProviderListAgentsRpc,
  WsAutomationListRpc,
  WsAutomationCreateRpc,
  WsAutomationUpdateRpc,
  WsAutomationDeleteRpc,
  WsAutomationRunNowRpc,
  WsAutomationCancelRunRpc,
  WsAutomationMarkRunReadRpc,
  WsAutomationArchiveRunRpc,
  WsSubscribeAutomationEventsRpc,
);
