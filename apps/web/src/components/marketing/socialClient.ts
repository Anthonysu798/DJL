import type { Campaign } from "@djl/contracts";
import type {
  CloudSocialAccountsResponse,
  CloudSocialOAuthStatus,
  CloudSocialOAuthStartResponse,
} from "@djl/contracts/cloud";
import { resolveWsHttpUrl } from "~/lib/wsHttpUrl";

export async function socialCommand<T>(input: Record<string, unknown>): Promise<T> {
  const response = await fetch(resolveWsHttpUrl("/api/marketing/social"), {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok)
    throw new Error(
      (await response.text()).slice(0, 300) || "Could not connect to social accounts.",
    );
  return response.json();
}
export const socialState = (campaign: Campaign) =>
  socialCommand<CloudSocialAccountsResponse & { attempts: CloudSocialOAuthStatus[] }>({
    action: "state",
    campaignId: campaign.id,
    threadId: campaign.threadId,
  });

export const disconnectSocial = (campaign: Campaign, version: number, accountId: string) =>
  socialCommand({
    action: "disconnect",
    campaignId: campaign.id,
    threadId: campaign.threadId,
    version,
    accountId,
  });
export const connectSocial = (
  campaign: Campaign,
  version: number,
  provider: "instagram" | "tiktok",
  accountId?: string,
) =>
  socialCommand<CloudSocialOAuthStartResponse>({
    action: "connect",
    campaignId: campaign.id,
    threadId: campaign.threadId,
    version,
    provider,
    ...(accountId ? { accountId } : {}),
  });
