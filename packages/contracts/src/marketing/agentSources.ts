import type { BrandProfile, MediaAsset } from "./campaign";

export interface ProductSourceFact {
  field: string;
  value: string;
  sourceUrl: string;
}
export interface AgentProductSource {
  id: string;
  sourceUrl: string;
  assetIds?: string[];
  title: string;
  description: string;
  brand?: string;
  price?: string;
  currency?: string;
  imageUrl?: string;
  facts: ProductSourceFact[];
  retrievedAt: string;
  trust: "untrusted-source";
}
export interface AgentProductImportResult {
  product: AgentProductSource;
  assetIds: string[];
  imageWarning?: string;
}
export interface AgentBrandMemoryResult {
  profile: BrandProfile;
  version: number | null;
}
export interface AgentLibraryItem {
  asset: MediaAsset;
  description: string;
  tags: string[];
  transcript: string;
  evidence: "user-provided-labels" | "product-page" | "generated-media";
  sourceUrl?: string;
  version: number;
}
export interface AgentMediaLibraryResult {
  products?: AgentProductSource[];
  items: AgentLibraryItem[];
  assetIds: string[];
}
