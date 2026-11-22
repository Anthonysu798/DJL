import type { Campaign } from "@djl/contracts";
import type {
  CloudSocialAccountsResponse,
  CloudSocialDraft,
  CloudSocialPublishTask,
} from "@djl/contracts/cloud";
import { resolveWsHttpUrl } from "~/lib/wsHttpUrl";

export function publishingCommand<T>(
  campaign: Campaign,
  version: number,
  input: Record<string, unknown>,
): Promise<T> {
  return fetch(resolveWsHttpUrl("/api/marketing/social-publishing"), {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...input,
      campaignId: campaign.id,
      threadId: campaign.threadId,
      version,
    }),
  }).then(async (response) => {
    if (!response.ok)
      throw new Error((await response.text()).slice(0, 300) || "Publishing request failed.");
    return response.json() as Promise<T>;
  });
}
export const publishingState = (campaign: Campaign, version: number) =>
  publishingCommand<{ drafts: CloudSocialDraft[]; accounts: CloudSocialAccountsResponse }>(
    campaign,
    version,
    { action: "state" },
  );

/** Signed URL stays in the browser; never include it in Agent tool results. */
export const publishingMediaPreview = (
  campaign: Campaign,
  version: number,
  draftId: string,
  revision: number,
) =>
  publishingCommand<{ url: string; mimeType: string; media?: { url: string; mimeType: string }[] }>(
    campaign,
    version,
    {
      action: "preview-media",
      draftId,
      revision,
    },
  );

/** A known container still preparing media is distinct from an uncertain publish write. */
export function socialTaskDisplayState(
  task: Pick<CloudSocialPublishTask, "state" | "errorCode" | "publishStartedAt">,
) {
  return task.state === "uncertain" &&
    task.errorCode === "awaiting_provider" &&
    task.publishStartedAt === null
    ? "publishing"
    : task.state;
}
