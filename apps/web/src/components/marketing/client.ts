import type { Campaign, MediaAsset, BrandProfile, ImageRecipe } from "@synara/contracts";
import { resolveWsHttpUrl } from "~/lib/wsHttpUrl";
export interface Stored<T> {
  value: T;
  version: number;
}
export interface MarketingState {
  jobs: Stored<{ id: string; campaignId: string; status: string; error?: string }>[];
  timelines: Stored<VideoTimeline>[];
  campaigns: Stored<Campaign>[];
  assets: Stored<MediaAsset>[];
  brand: Stored<BrandProfile>;
  recipes: Stored<{ id: string; recipe: ImageRecipe }>[];
}
export const mediaUrl = (id: string, rendered = false, download = false) =>
  resolveWsHttpUrl(
    `/api/marketing/${rendered ? "render" : "asset"}/${id}${download ? "?download=1" : ""}`,
  );
async function request(path: string, init?: RequestInit) {
  const response = await fetch(resolveWsHttpUrl(`/api/marketing/${path}`), {
    credentials: "same-origin",
    ...init,
  });
  if (!response.ok)
    throw new Error((await response.text()).slice(0, 500) || `Request failed (${response.status})`);
  return response.json();
}
export const loadMarketing = (): Promise<MarketingState> => request("state");
export const command = (input: Record<string, unknown>) =>
  request("command", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
export const importMedia = (file: File, signal?: AbortSignal): Promise<Stored<MediaAsset>> =>
  request("import", {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "X-DJL-Filename": encodeURIComponent(file.name),
    },
    body: file,
    ...(signal ? { signal } : {}),
  });
export interface VideoClip {
  assetId: string;
  start: number;
  end: number;
  speed: number;
}
export interface VideoTimeline {
  campaignId: string;
  version: number;
  width: number;
  height: number;
  clips: VideoClip[];
}
export const saveTimeline = (value: VideoTimeline) =>
  request("timeline", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value),
  });
export const downloadTimeline = (value: VideoTimeline) =>
  request("video-export", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value),
  });
export const exportUrl = (id: string) => resolveWsHttpUrl(`/api/marketing/job/${id}`);
export const cancelJob = (id: string) => request(`job/${id}/cancel`, { method: "POST" });

export const loadModels = (): Promise<
  { id: string; displayName: string; capabilities: string[] }[]
> => request("models");
export const generateCopy = (input: {
  campaignId: string;
  version: number;
  model: string;
  includeImages: boolean;
  consent: boolean;
}): Promise<{ captions: Record<string, string>; revision: number }> =>
  request("generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

export const loadThreadMarketing = (
  threadId: string,
): Promise<{ campaigns: Stored<Campaign>[]; assets: Stored<MediaAsset>[] }> =>
  request("thread/" + encodeURIComponent(threadId));
export async function downloadPublishingKit(id: string, revision: number) {
  const response = await fetch(resolveWsHttpUrl(`/api/marketing/kit/${id}?revision=${revision}`), {
    credentials: "same-origin",
  });
  if (!response.ok) throw new Error((await response.text()).slice(0, 500));
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = "publishing-kit.zip";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
