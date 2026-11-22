/** DJL-owned contracts. Platform credentials never cross this boundary. */
export type MultiPostKind = "dynamic" | "article" | "video" | "podcast";
export interface MultiPostFile {
  name: string;
  url: string;
  type?: string;
  size?: number;
  /** The point of a photo to keep in view when a platform crops it, from 0 to 1 on each axis. */
  focus?: { x: number; y: number };
}
/**
 * The picture shape (width / height) a platform's own uploader crops to unless told otherwise.
 * DJL crops first, around the person's chosen focus, so what they saw is what gets posted.
 */
export const MULTIPOST_CROP_RATIO: Readonly<Record<string, number>> = { instagram: 1 };
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
/** Standing permission the user switched on for one account. Never set by an agent. */
export interface MultiPostAutopilot {
  dailyLimit: number;
  expiresAt: string;
  timezone: string;
}
export interface MultiPostAccount {
  id: string;
  workspaceId: string;
  platformKey: string;
  label: string;
  homeUrl?: string;
  status: "disconnected" | "needs-login" | "connected";
  identity: MultiPostIdentity | null;
  autopilot?: MultiPostAutopilot | null;
  /** When DJL last confirmed by itself that this account is still signed in. */
  checkedAt?: string;
  createdAt: string;
}
/** What the desktop tells the person when a post finishes while they are elsewhere. */
export interface MultiPostNotice {
  kind: "posted" | "failed" | "needs-you";
  platformKey: string;
  label: string;
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
  /** Queued under the account's autopilot instead of a per-post approval. */
  autopilot?: boolean;
  evidence: MultiPostEvidence | null;
  error: string | null;
  /** When DJL put the post back in line by itself after the connection dropped; it does so once. */
  retriedAt?: string;
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
/** Everything a person or agent needs to say to publish one post. */
export interface MultiPostQuickPost {
  text: string;
  title?: string;
  /** Uploaded files, `Media/` references, or paths inside the workspace or chat attachments. */
  media?: (string | MultiPostFile)[];
  /** Defaults to every signed-in account. */
  accountIds?: string[];
  scheduledAt?: string | null;
  timezone?: string;
}
export interface MultiPostQuickPostResult {
  drafts: MultiPostDraft[];
  jobs: MultiPostJob[];
  posted: boolean;
  needsApproval: boolean;
  skipped: {
    accountId: string;
    label: string;
    reason: "needs-video" | "needs-media" | "unsupported";
  }[];
  message: string;
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
      /** Post it now through these accounts instead of saving a draft to review. */
      post?: boolean;
      publicationMode?: "now" | "scheduled";
      scheduledAt?: string;
      timezone?: string;
    }
  | { action: "create-account"; platformKey: string; label: string; homeUrl?: string }
  | {
      action: "connect-account" | "verify-account" | "disconnect-account" | "remove-account";
      accountId: string;
    }
  | { action: "check-accounts" }
  | { action: "reschedule-job"; jobId: string; scheduledAt: string }
  | { action: "set-autopilot"; accountId: string; enabled: boolean; dailyLimit?: number }
  | { action: "quick-post"; post: MultiPostQuickPost }
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
  notify?(notice: MultiPostNotice): Promise<void>;
  /** The public address of a post that was shared without one, if the platform shows it now. */
  postLink?(context: MultiPostRuntimeContext): Promise<string | null>;
}
