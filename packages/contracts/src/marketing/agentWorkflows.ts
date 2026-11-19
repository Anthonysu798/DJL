import type { CloudSocialDraft, CloudSocialMetricsResponse } from "../cloud/socialPublishing";

export type SocialPreparationTool =
  | "djl_import_product_url"
  | "djl_brand_memory"
  | "djl_media_library"
  | "djl_inspect_social_media"
  | "djl_repurpose_video"
  | "djl_transcribe_video"
  | "djl_prepare_marketing";

export interface SocialWorkflowStep {
  id: string;
  tool: SocialPreparationTool;
  label: string;
  args: Record<string, unknown>;
}
export interface SocialWorkflow {
  id: string;
  ownerKey: string;
  name: string;
  steps: SocialWorkflowStep[];
  archived: boolean;
  updatedAt: string;
}
export interface SocialWorkflowRun {
  id: string;
  ownerKey: string;
  threadId: string;
  workflowId: string;
  workflowVersion: number;
  name: string;
  sources: Record<string, string>;
  steps: (SocialWorkflowStep & {
    sourceArgs?: Record<string, unknown>;
    status: "pending" | "completed" | "blocked";
    reason: string | null;
    result: Record<string, unknown> | null;
  })[];
  currentStep: number | null;
  status: "ready" | "blocked" | "awaiting_review";
  requiresReview: true;
  createdAt: string;
  updatedAt: string;
}
export interface SocialWorkflowRecord {
  value: SocialWorkflow;
  version: number;
}
export interface SocialWorkflowRunRecord {
  value: SocialWorkflowRun;
  version: number;
}
export interface SocialWorkflowsResponse {
  workflows?: SocialWorkflowRecord[];
  runs?: SocialWorkflowRunRecord[];
  workflow?: SocialWorkflowRecord;
  run?: SocialWorkflowRunRecord;
  requiresReview: true;
}
export interface SocialInboxIssue {
  provider: string | null;
  taskId: string | null;
  code: string;
}
export interface SocialInboxItem {
  campaignId: string;
  threadId: string;
  name: string;
  version: number;
  drafts: CloudSocialDraft[];
  accounts: { id: string; provider: string }[];
  issues: SocialInboxIssue[];
  nextScheduledAt: string | null;
}
export interface SocialInboxResponse {
  items: SocialInboxItem[];
  retrievedAt: string;
  limitations: string[];
}
export interface SocialCoachPost {
  campaignId: string;
  threadId: string;
  draftId: string;
  taskId: string;
  provider: string;
  accountId: string;
  publishedAt: string;
  publishedAtBasis: "task_updated_at";
  retrievedAt: string;
  postUrl: string | null;
  metrics: CloudSocialMetricsResponse["metrics"];
  unavailableReason: string | null;
}
export interface SocialCoachProvider {
  provider: string;
  publishedPosts: number;
  averages: CloudSocialMetricsResponse["metrics"];
  availableSamples: { views: number; likes: number; comments: number; shares: number };
}
export interface SocialCoachResponse {
  days: number;
  periodStart: string;
  retrievedAt: string;
  posts: SocialCoachPost[];
  providers: SocialCoachProvider[];
  limitations: string[];
}
