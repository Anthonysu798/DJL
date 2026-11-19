/** DJL-owned contracts. Platform credentials never cross this boundary. */
export type MultiPostKind = "dynamic" | "article" | "video" | "podcast";
export interface MultiPostFile {
  name: string;
  url: string;
  type?: string;
  size?: number;
}
export interface MultiPostContentData {
  title: string;
  content?: string;
  description?: string;
  digest?: string;
  htmlContent?: string;
  markdownContent?: string;
  images?: MultiPostFile[];
  videos?: MultiPostFile[];
  video?: MultiPostFile;
  audio?: MultiPostFile;
  cover?: MultiPostFile;
  verticalCover?: MultiPostFile;
  horizontalCover?: MultiPostFile;
  wordFileData?: MultiPostFile;
  tags?: string[];
  category?: string | number;
  collectionId?: string | number;
  original?: boolean;
  allowComment?: boolean;
  scheduledPublishTime?: number;
}
export interface MultiPostIdentity {
  provider: string;
  accountId: string;
  username: string;
  verifiedAt: string;
}
export interface MultiPostAccount {
  id: string;
  workspaceId: string;
  platformKey: string;
  label: string;
  homeUrl?: string;
  status: "disconnected" | "needs-login" | "connected";
  identity: MultiPostIdentity | null;
  createdAt: string;
}
export interface MultiPostTarget {
  accountId: string;
  adapterId: string;
  extraConfig?: Record<string, unknown>;
  overrides?: Partial<MultiPostContentData>;
}
export interface MultiPostDraft {
  id: string;
  workspaceId: string;
  threadId: string;
  revision: number;
  kind: MultiPostKind;
  data: MultiPostContentData;
  targets: MultiPostTarget[];
  approvedRevision: number | null;
  publicationMode: "now" | "scheduled";
  scheduledAt: string | null;
  timezone: string;
  workflowId?: string;
  workflowRevision?: number;
  createdAt: string;
  updatedAt: string;
}
export type MultiPostJobState =
  | "queued"
  | "preparing"
  | "prepared"
  | "submitting"
  | "needs-login"
  | "missed"
  | "scheduled-on-platform"
  | "uncertain"
  | "delivered"
  | "published"
  | "failed"
  | "cancelled";
export interface MultiPostEvidence {
  state:
    | "prepared"
    | "missed"
    | "needs-login"
    | "scheduled-on-platform"
    | "uncertain"
    | "delivered"
    | "published"
    | "cancelled";
  postUrl?: string;
  providerPostId?: string;
  /** Emitted only by the authenticated browser host after a new platform acknowledgement. */
  providerConfirmation?: "instagram-post-shared";
  message?: string;
  requiresManual?: boolean;
  dispatched?: boolean;
  observedAt: string;
}
export interface MultiPostJob {
  id: string;
  workspaceId: string;
  threadId: string;
  draftId: string;
  revision: number;
  accountId: string;
  adapterId: string;
  snapshot: MultiPostDraft;
  target: MultiPostTarget;
  state: MultiPostJobState;
  dueAt: string;
  submittedAt: string | null;
  grantId: string | null;
  evidence: MultiPostEvidence | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface MultiPostWorkflow {
  id: string;
  workspaceId: string;
  name: string;
  revision: number;
  kinds: MultiPostKind[];
  accountIds: string[];
  preparationWorkflowId?: string;
}
export interface MultiPostGrant {
  id: string;
  workspaceId: string;
  workflowId: string;
  workflowRevision: number;
  accountIds: string[];
  kinds: MultiPostKind[];
  expiresAt: string;
  dailyLimit: number;
  timezone: string;
  revokedAt: string | null;
  createdAt: string;
}
export interface MultiPostCapability {
  id: string;
  platformKey: string;
  kind: MultiPostKind;
  displayName: string;
  homeUrl: string;
  injectUrl: string;
  identitySupported: boolean;
  automaticSubmit?: boolean;
  supportsNativeScheduling?: boolean;
}
export interface MultiPostState {
  accounts: MultiPostAccount[];
  drafts: MultiPostDraft[];
  jobs: MultiPostJob[];
  workflows: MultiPostWorkflow[];
  grants: MultiPostGrant[];
  capabilities: MultiPostCapability[];
  runtimeAvailable: boolean;
  currentTime?: string;
  localTimezone?: string;
  attachments?: { path: string; name: string; bytes: number }[];
}
export interface MultiPostScope {
  workspaceId: string;
  threadId: string;
  authorizedRoot: string;
  mediaRoot?: string;
  attachmentsRoot?: string;
}
export type MultiPostActor = "ui" | "agent";
export type MultiPostCommand =
  | { action: "state" }
  | {
      action: "import-campaign";
      campaignId: string;
      version: number;
      accountIds?: string[];
      publicationMode?: "now" | "scheduled";
      scheduledAt?: string;
      timezone?: string;
    }
  | { action: "create-account"; platformKey: string; label: string; homeUrl?: string }
  | { action: "connect-account" | "verify-account" | "disconnect-account"; accountId: string }
  | {
      action: "save-draft";
      draft: Pick<
        MultiPostDraft,
        "kind" | "data" | "targets" | "publicationMode" | "scheduledAt" | "timezone"
      > &
        Partial<Pick<MultiPostDraft, "id" | "revision" | "workflowId" | "workflowRevision">> & {
          replaceContent?: boolean;
        };
    }
  | {
      action: "review-draft" | "approve-draft" | "submit-draft";
      draftId: string;
      revision: number;
      grantId?: string;
    }
  | { action: "cancel-job" | "retry-job" | "open-job" | "verify-job" | "close-job"; jobId: string }
  | {
      action: "save-workflow";
      workflow: Omit<MultiPostWorkflow, "workspaceId" | "id" | "revision"> & {
        id?: string;
        revision?: number;
      };
    }
  | {
      action: "create-grant";
      grant: Omit<MultiPostGrant, "id" | "workspaceId" | "createdAt" | "revokedAt">;
    }
  | { action: "revoke-grant"; grantId: string }
  | { action: "request-authorization"; workflowId?: string }
  | { action: "inspect-media" | "import-media"; paths: string[] };
export interface MultiPostRuntimeContext {
  scope: MultiPostScope;
  account: MultiPostAccount;
  job: MultiPostJob;
}
export interface MultiPostBrowserRuntime {
  available(): Promise<boolean>;
  open?(context: MultiPostRuntimeContext): Promise<void>;
  close?(context: MultiPostRuntimeContext): Promise<void>;
  connect(scope: MultiPostScope, account: MultiPostAccount): Promise<void>;
  identity(scope: MultiPostScope, account: MultiPostAccount): Promise<MultiPostIdentity | null>;
  prepare(context: MultiPostRuntimeContext, signal?: AbortSignal): Promise<MultiPostEvidence>;
  submit(context: MultiPostRuntimeContext, signal?: AbortSignal): Promise<MultiPostEvidence>;
  verify(context: MultiPostRuntimeContext): Promise<MultiPostEvidence>;
  cancel(context: MultiPostRuntimeContext): Promise<MultiPostEvidence>;
  disconnect(scope: MultiPostScope, account: MultiPostAccount): Promise<void>;
}
