import { Schema } from "effect";
import { NonNegativeInt, TrimmedNonEmptyString } from "../baseSchemas";

export const CloudSocialProvider = Schema.Literals(["instagram", "tiktok"]);
const Id = Schema.String.check(Schema.isPattern(/^[0-9a-f-]{36}$/i));
const ContextId = TrimmedNonEmptyString.check(Schema.isMaxLength(200));
export const CloudSocialOAuthStartInput = Schema.Struct({
  provider: CloudSocialProvider,
  threadId: ContextId,
  campaignId: ContextId,
  revision: NonNegativeInt,
  accountId: Schema.optionalKey(Id),
});
export type CloudSocialOAuthStartInput = typeof CloudSocialOAuthStartInput.Type;
export const CloudSocialOAuthStatusQuery = Schema.Struct({ attemptId: Id });
export const CloudSocialDisconnectInput = Schema.Struct({ accountId: Id });
export interface CloudSocialAccount {
  id: string;
  provider: "instagram" | "tiktok";
  providerAccountId: string;
  username: string;
  displayName: string;
  scopes: string[];
  capabilities: { publish: boolean; metrics: boolean };
  status: "connected" | "disconnected";
  expiresAt: string;
}
export interface CloudSocialAccountsResponse {
  providers: {
    provider: "instagram" | "tiktok" | "xiaohongshu";
    available: boolean;
    reason: string | null;
  }[];
  accounts: CloudSocialAccount[];
}
export interface CloudSocialOAuthStartResponse {
  attemptId: string;
  authorizationUrl: string;
  expiresAt: string;
}
export interface CloudSocialOAuthStatus {
  attemptId: string;
  status: "pending" | "processing" | "connected" | "failed" | "cancelled" | "expired";
  threadId: string;
  campaignId: string;
  revision: number;
  accountId: string | null;
  errorCode: string | null;
}

export interface CloudSocialCreatorInfo {
  nickname: string;
  username: string;
  privacyLevels: string[];
  duetDisabled: boolean;
  stitchDisabled: boolean;
  commentDisabled: boolean;
  maxVideoDurationSeconds: number;
}
