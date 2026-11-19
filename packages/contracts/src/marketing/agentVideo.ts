/** Times are seconds on the original media timeline, including subtitle and cover times. */
export interface AgentVideoSubtitle {
  start: number;
  end: number;
  text: string;
}
export interface AgentVideoClipInput {
  start: number;
  end: number;
  crop: "original" | "vertical";
  /** Position within the available crop travel: 0 = left/top, 1 = right/bottom. */
  focalPoint?: { x: number; y: number };
  coverAt?: number;
  subtitles?: AgentVideoSubtitle[];
}
export type AgentVideoRepurposeInput =
  | {
      action: "render";
      campaignId: string;
      version: number;
      assetId: string;
      clips: AgentVideoClipInput[];
      subtitleProvenance?: "user-provided" | "transcript";
      transcriptId?: string;
    }
  | { action: "list" }
  | { action: "get" | "cancel"; jobId: string };
export interface AgentVideoTranscribeInput {
  campaignId: string;
  assetId: string;
  start?: number;
  end?: number;
  chunkSeconds?: number;
}
export interface AgentVideoClipResult {
  assetId: string;
  coverAssetId: string;
  start: number;
  end: number;
  crop: "original" | "vertical";
  width: number;
  height: number;
  duration: number;
  subtitleProvenance: "user-provided" | "transcript" | null;
  bytes?: number;
  coverAt?: number;
  focalPoint?: { x: number; y: number };
}
export interface AgentVideoJob {
  id: string;
  ownerKey: string;
  threadId: string;
  campaignId: string;
  sourceAssetId: string;
  status: "rendering" | "complete" | "failed" | "canceled" | "interrupted";
  createdAt: string;
  updatedAt: string;
  clips: AgentVideoClipResult[];
  campaignVersion?: number;
  error?: string;
}
export interface AgentVideoTranscript {
  id: string;
  ownerKey: string;
  threadId: string;
  assetId: string;
  campaignId: string;
  provenance: "codex-transcription";
  timing: "audio-chunk";
  segments: AgentVideoSubtitle[];
  createdAt: string;
  limitations: string;
}
export type AgentVideoTranscribeResult =
  | { status: "complete"; transcript: AgentVideoTranscript }
  | { status: "unavailable"; nextStep: string; limits: string };
export type AgentVideoRepurposeResult =
  | (AgentVideoJob & { version: number; limitations?: string })
  | { jobs: AgentVideoJob[]; transcripts: AgentVideoTranscript[]; limits: string }
  | { status: "cancel-requested"; jobId: string };
