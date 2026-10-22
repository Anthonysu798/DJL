/** Shared, deterministic campaign rules. No provider access is inferred from a platform name. */
export const platforms = [
  ["instagram", "Instagram", "https://www.instagram.com/"],
  ["facebook", "Facebook Pages", "https://www.facebook.com/"],
  ["tiktok", "TikTok", "https://www.tiktok.com/"],
  ["youtube", "YouTube", "https://studio.youtube.com/"],
  ["linkedin", "LinkedIn", "https://www.linkedin.com/"],
  ["pinterest", "Pinterest", "https://www.pinterest.com/"],
  ["threads", "Threads", "https://www.threads.com/"],
  ["x", "X", "https://x.com/"],
  ["douyin", "抖音", "https://www.douyin.com/"],
  ["red", "小红书", "https://www.xiaohongshu.com/"],
  ["kuaishou", "快手", "https://www.kuaishou.com/"],
  ["bilibili", "哔哩哔哩", "https://www.bilibili.com/"],
  ["wechat", "微信视频号", "https://channels.weixin.qq.com/"],
  ["whatsapp", "WhatsApp Business", "https://business.whatsapp.com/"],
].map(([id, name, url]) => ({
  id: id!,
  name: name!,
  url: url!,
  directPublishing: false as const,
  kind: id === "whatsapp" ? "business-messaging" : "social",
}));

export interface ImageRecipe {
  exposure: number;
  contrast: number;
  saturation: number;
  temperature: number;
  rotation: number;
  flip: boolean;
  width: number | null;
  height: number | null;
}
export const defaultImageRecipe: ImageRecipe = {
  exposure: 0,
  contrast: 1,
  saturation: 1,
  temperature: 0,
  rotation: 0,
  flip: false,
  width: null,
  height: null,
};
export interface MediaAsset {
  id: string;
  name: string;
  mime: string;
  bytes: number;
  createdAt: string;
  width?: number;
  height?: number;
  duration?: number;
}
export interface BrandProfile {
  name: string;
  description: string;
  audience: string;
  tone: string;
  colors: string;
  website: string;
  facts: string;
  prohibitedClaims: string;
  language: string;
}
export const defaultBrand: BrandProfile = {
  name: "",
  description: "",
  audience: "",
  tone: "Professional",
  colors: "",
  website: "",
  facts: "",
  prohibitedClaims: "",
  language: "English",
};
export interface Publication {
  source: "user-confirmed";
  confirmedAt: string;
  revision: number;
}
export interface Campaign {
  id: string;
  name: string;
  brief: string;
  revision: number;
  approvedRevision: number | null;
  assetIds: string[];
  platforms: string[];
  captions: Record<string, string>;
  publications: Record<string, Publication>;
  createdAt: string;
  updatedAt: string;
}
export type CampaignPatch = Partial<
  Pick<Campaign, "name" | "brief" | "assetIds" | "platforms" | "captions">
>;
export function createCampaign(name: string): Campaign {
  if (!name.trim() || name.length > 200)
    throw new Error("Enter a campaign name of 1–200 characters.");
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    name: name.trim(),
    brief: "",
    revision: 1,
    approvedRevision: null,
    assetIds: [],
    platforms: [],
    captions: {},
    publications: {},
    createdAt: now,
    updatedAt: now,
  };
}
export function reviseCampaign(campaign: Campaign, patch: CampaignPatch): Campaign {
  const next = { ...campaign, ...patch };
  if (!next.name.trim() || next.name.length > 200)
    throw new Error("Campaign name is required (maximum 200 characters).");
  if (next.brief.length > 20000 || Object.values(next.captions).some((c) => c.length > 20000))
    throw new Error("Text exceeds the 20,000 character limit.");
  if (next.platforms.some((id) => !platforms.some((p) => p.id === id)))
    throw new Error("Unknown platform.");
  return {
    ...next,
    revision: campaign.revision + 1,
    approvedRevision: null,
    updatedAt: new Date().toISOString(),
  };
}
export function approveCampaign(campaign: Campaign, revision: number): Campaign {
  if (revision !== campaign.revision)
    throw new Error("Campaign changed. Review the latest revision.");
  if (
    !campaign.assetIds.length ||
    !campaign.platforms.length ||
    campaign.platforms.some((p) => !campaign.captions[p]?.trim())
  )
    throw new Error(
      "Add media, select destinations, and write copy for every destination before approval.",
    );
  return { ...campaign, approvedRevision: revision };
}
export function confirmAssistedPublication(campaign: Campaign, platform: string): Campaign {
  if (campaign.approvedRevision !== campaign.revision || !campaign.platforms.includes(platform))
    throw new Error("Review and approve this revision before confirming publication.");
  if (campaign.publications[platform]?.revision === campaign.revision) return campaign;
  return {
    ...campaign,
    publications: {
      ...campaign.publications,
      [platform]: {
        source: "user-confirmed",
        revision: campaign.revision,
        confirmedAt: new Date().toISOString(),
      },
    },
  };
}
