import {
  assertAgentCampaignAccess,
  assertAgentMediaAccess,
  agentOwnerFromSession,
} from "./agentScope";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { Effect, Schema } from "effect";

import { readFile } from "node:fs/promises";
import { type Campaign, type MediaAsset } from "@synara/contracts";
import {
  CloudSocialDraftInput,
  type CloudSocialDraft,
  type CloudSocialAccountsResponse,
  type CloudSocialReviewLink,
  type CloudSocialReviewLinkCreated,
  CloudSocialReportScheduleInput,
  type CloudSocialTrackingLink,
  type CloudSocialTrackingLinkCreated,
} from "@synara/contracts/cloud";
import { DJL_CLOUD_HOSTS, resolveCloudWebUrl } from "../cloud/api";
import type { ServerConfigShape } from "../config";
import { createSocialCloudClient } from "./socialCloudClient";
import { readCloudSession } from "../cloud/session";
import { readDocument, listDocuments, MarketingError } from "./store";

interface Binding {
  apiBaseUrl: string;
  campaignId: string;
  campaignRevision: number;
  draftId: string;
  cloudRevision: number;
  userId: string;
  orgId: string;
  mediaMimeType?: string;
  mediaFileId?: string;
  mediaFiles?: { fileId: string; mimeType: string }[];
  mediaSources?: { assetId: string; assetVersion: number; recipeVersion: number | null }[];
}
export function validatePublishingBinding(binding: Binding | undefined, expected: Binding) {
  if (
    !binding ||
    Object.keys(expected).some(
      (key) => binding[key as keyof Binding] !== expected[key as keyof Binding],
    )
  )
    throw new MarketingError("This publishing preview changed. Prepare and review it again.", 409);
}
const Input = Schema.Struct({
  action: Schema.Literals([
    "state",
    "prepare",
    "confirm",
    "task",
    "metrics",
    "creator-info",
    "preview-media",
    "review-links",
    "create-review-link",
    "revoke-review-link",
    "report-state",
    "report-schedule",
    "tracking-links",
    "create-tracking-link",
    "revoke-tracking-link",
  ]),
  campaignId: Schema.String,
  threadId: Schema.String,
  version: Schema.optional(Schema.Int),
  accountIds: Schema.optional(Schema.Array(Schema.String)),
  publicationMode: Schema.optional(Schema.Literals(["now", "scheduled"])),
  scheduledAt: Schema.optional(Schema.String),
  timezone: Schema.optional(Schema.String),
  draftId: Schema.optional(Schema.String),
  revision: Schema.optional(Schema.Int),
  taskId: Schema.optional(Schema.String),
  taskAction: Schema.optional(Schema.Literals(["cancel", "retry"])),
  accountId: Schema.optional(Schema.String),
  tiktokOptions: CloudSocialDraftInput.fields.tiktokOptions,
  linkId: Schema.optional(Schema.String),
  expiresInHours: Schema.optional(Schema.Literals([24, 72, 168])),
  disclosureAccepted: Schema.optional(Schema.Boolean),
  schedule: Schema.optional(CloudSocialReportScheduleInput),
  url: Schema.optional(Schema.String),
  expiresInDays: Schema.optional(Schema.Literals([7, 30, 90])),
});
const attempt = <T>(fn: () => Promise<T>) =>
  Effect.tryPromise({
    try: fn,
    catch: (e) =>
      e instanceof MarketingError
        ? e
        : new MarketingError(
            "Cloud publishing request failed. Your saved draft is preserved.",
            503,
          ),
  });

const defaults = {
  session: readCloudSession,
  client: createSocialCloudClient,
  fetch: fetch,
  readFile: readFile,
};
export function publishingBridge(
  config: Pick<ServerConfigShape, "stateDir" | "secretsDir">,
  raw: unknown,
  deps = defaults,
) {
  return Effect.gen(function* () {
    const input = yield* Effect.try({
      try: () => Schema.decodeUnknownSync(Input)(raw),
      catch: () => new MarketingError("Invalid publishing action."),
    });
    const record = yield* readDocument("campaign", input.campaignId);
    const campaign = record?.value as Campaign | undefined;
    if (!campaign || campaign.threadId !== input.threadId)
      return yield* Effect.fail(
        new MarketingError("Campaign belongs to another conversation or is missing.", 404),
      );
    if (input.action === "prepare")
      return yield* Effect.fail(
        new MarketingError(
          "New publishing uses DJL MultiPost. Import this campaign into the MultiPost workbench and review it again.",
          409,
        ),
      );
    const session = yield* attempt(() => deps.session(config.secretsDir));
    if (!session)
      return yield* Effect.fail(
        new MarketingError("Sign in to DJL Cloud to prepare publishing.", 401),
      );
    const ownershipScope = {
      threadId: input.threadId,
      authorizedRoot: config.stateDir,
      attachmentFiles: [],
      stateDir: config.stateDir,
      secretsDir: config.secretsDir,
    };
    const authenticatedOwner = agentOwnerFromSession(session);
    yield* assertAgentCampaignAccess(ownershipScope, campaign, authenticatedOwner);
    if (input.action !== "state" && record!.version !== input.version)
      return yield* Effect.fail(
        new MarketingError("Campaign changed. Review the latest card.", 409),
      );
    const cloud = deps.client(session.apiBaseUrl, session.orgId);
    const owner = { userId: session.userId, orgId: session.orgId, apiBaseUrl: session.apiBaseUrl };
    const publicOrigin = (serverUrl?: string) => {
      if (
        !serverUrl &&
        !process.env.DJL_CLOUD_WEB_URL?.trim() &&
        !Object.values(DJL_CLOUD_HOSTS).some(
          (url) => url === session.apiBaseUrl.replace(/\/+$/, ""),
        )
      )
        throw new MarketingError(
          "The cloud server needs an update before links can be shared from this environment.",
          503,
        );
      return new URL(serverUrl ?? resolveCloudWebUrl());
    };
    const validateMediaSources = (binding: Binding | undefined) =>
      Effect.gen(function* () {
        if (!binding?.mediaSources) return;
        if (
          binding.mediaSources.length !== campaign.assetIds.length ||
          binding.mediaSources.some((source, index) => source.assetId !== campaign.assetIds[index])
        )
          return yield* Effect.fail(
            new MarketingError("Selected media changed. Prepare and review again.", 409),
          );
        for (const source of binding.mediaSources) {
          const asset = yield* readDocument("asset", source.assetId);
          const recipe = yield* readDocument("recipe", source.assetId);
          if (
            !asset ||
            asset.version !== source.assetVersion ||
            (recipe?.version ?? null) !== source.recipeVersion
          )
            return yield* Effect.fail(
              new MarketingError("Media changed. Prepare and review again.", 409),
            );
          yield* assertAgentMediaAccess(
            ownershipScope,
            asset.value as MediaAsset,
            authenticatedOwner,
          );
        }
      });
    if (input.action === "state") {
      const links = (yield* listDocuments("social-draft-link"))
        .map((r) => r.value as Binding)
        .filter(
          (b) =>
            b.campaignId === campaign.id &&
            b.userId === owner.userId &&
            b.orgId === owner.orgId &&
            b.apiBaseUrl === owner.apiBaseUrl,
        );
      const [drafts, accounts] = yield* attempt(() =>
        Promise.all([
          cloud.get<CloudSocialDraft[]>(
            `/v1/social/drafts?${new URLSearchParams({ threadId: input.threadId })}`,
            session.token,
          ),
          cloud.get<CloudSocialAccountsResponse>("/v1/social/accounts", session.token),
        ]),
      );
      return { drafts: drafts.filter((d) => links.some((l) => l.draftId === d.id)), accounts };
    }
    if (input.action === "creator-info") {
      if (!input.accountId)
        return yield* Effect.fail(new MarketingError("Choose a TikTok account."));
      const accounts = yield* attempt(() =>
        cloud.get<CloudSocialAccountsResponse>("/v1/social/accounts", session.token),
      );
      if (
        !accounts.accounts.some(
          (a) =>
            a.id === input.accountId &&
            a.provider === "tiktok" &&
            a.status === "connected" &&
            campaign.platforms.includes("tiktok"),
        )
      )
        return yield* Effect.fail(new MarketingError("Choose a connected TikTok account.", 404));
      return yield* attempt(() =>
        cloud.get(
          `/v1/social/accounts/${encodeURIComponent(input.accountId!)}/creator-info`,
          session.token,
        ),
      );
    }
    if (["tracking-links", "create-tracking-link", "revoke-tracking-link"].includes(input.action)) {
      const route = "/v1/social/tracking-links";
      const publicUrl = (publicPath: string, serverUrl?: string) => {
        const origin = publicOrigin(serverUrl);
        const target = new URL(serverUrl ?? publicPath, origin);
        if (
          target.origin !== origin.origin ||
          !/^\/l\/[A-Za-z0-9_-]{22}$/.test(target.pathname) ||
          target.pathname !== publicPath ||
          target.search ||
          target.hash ||
          target.username ||
          target.password ||
          (target.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(target.hostname))
        )
          throw new MarketingError("The link website is unavailable.", 503);
        return target.href;
      };
      const list = () =>
        cloud.get<CloudSocialTrackingLink[]>(
          `${route}?campaignId=${encodeURIComponent(campaign.id)}&threadId=${encodeURIComponent(input.threadId)}`,
          session.token,
        );
      if (input.action === "tracking-links")
        return yield* attempt(async () =>
          (await list()).map((link) =>
            Object.assign({}, link, { trackingUrl: publicUrl(link.publicPath, link.trackingUrl) }),
          ),
        );
      if (input.action === "revoke-tracking-link") {
        const items = yield* attempt(list);
        if (
          !input.linkId ||
          !items.some(
            (link) =>
              link.id === input.linkId &&
              link.campaignId === campaign.id &&
              link.threadId === input.threadId,
          )
        )
          return yield* Effect.fail(
            new MarketingError("Link is not part of this chat's campaign.", 404),
          );
        return yield* attempt(async () => {
          const response = await deps.fetch(
            `${cloud.baseUrl}${route}/${encodeURIComponent(input.linkId!)}`,
            {
              method: "DELETE",
              headers: { authorization: `Bearer ${session.token}`, "x-org-id": session.orgId },
              redirect: "error",
              signal: AbortSignal.timeout(10000),
            },
          );
          if (!response.ok)
            throw new MarketingError("Could not revoke the link. Try again.", response.status);
          return response.json();
        });
      }
      if (!input.url || !input.expiresInDays || input.disclosureAccepted !== true)
        return yield* Effect.fail(
          new MarketingError("Choose a website and accept aggregate link-open tracking first."),
        );
      const created = yield* attempt(() =>
        cloud.post<CloudSocialTrackingLinkCreated>(
          route,
          {
            url: input.url,
            campaignId: campaign.id,
            threadId: input.threadId,
            contentRevision: campaign.revision,
            expiresInDays: input.expiresInDays,
            disclosureAccepted: true,
          },
          session.token,
        ),
      );
      const trackingUrl = yield* Effect.try({
        try: () => publicUrl(created.publicPath, created.trackingUrl),
        catch: () =>
          new MarketingError("The link website is unavailable. Reload your saved links.", 503),
      });
      return { ...created, trackingUrl };
    }
    const links = (yield* listDocuments("social-draft-link"))
      .map((r) => r.value as Binding)
      .filter(
        (b) =>
          b.campaignId === campaign.id &&
          b.userId === owner.userId &&
          b.orgId === owner.orgId &&
          b.apiBaseUrl === owner.apiBaseUrl,
      );
    if (
      [
        "review-links",
        "create-review-link",
        "revoke-review-link",
        "report-state",
        "report-schedule",
      ].includes(input.action)
    ) {
      const binding = links.find((link) => link.draftId === input.draftId);
      if (!binding)
        return yield* Effect.fail(
          new MarketingError("Select an owned publishing preview from this chat.", 404),
        );
      const draft = yield* attempt(() =>
        cloud.get<CloudSocialDraft>(
          `/v1/social/drafts/${encodeURIComponent(binding.draftId)}`,
          session.token,
        ),
      );
      if (
        draft.threadId !== input.threadId ||
        draft.userId !== owner.userId ||
        draft.orgId !== owner.orgId
      )
        return yield* Effect.fail(
          new MarketingError("Publishing preview belongs to another workspace.", 404),
        );
      const route = `/v1/social/drafts/${encodeURIComponent(draft.id)}`;
      const write = (method: "PUT" | "DELETE", path: string, body?: unknown) =>
        attempt(async () => {
          const response = await deps.fetch(`${cloud.baseUrl}${path}`, {
            method,
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${session.token}`,
              "x-org-id": session.orgId,
            },
            ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
            redirect: "error",
            signal: AbortSignal.timeout(10000),
          });
          if (!response.ok)
            throw new MarketingError(
              "The saved review or recap could not be updated. Reload and try again.",
              response.status,
            );
          return response.json();
        });
      if (input.action === "report-state")
        return yield* attempt(() => cloud.get(`${route}/reports`, session.token));
      if (input.action === "report-schedule") {
        if (!input.schedule)
          return yield* Effect.fail(
            new MarketingError("Choose and explicitly save a recap preference."),
          );
        return yield* write("PUT", `${route}/report-schedule`, input.schedule);
      }
      if (input.action === "review-links")
        return yield* attempt(() => cloud.get(`${route}/review-links`, session.token));
      if (input.action === "revoke-review-link") {
        const reviewLinks = yield* attempt(() =>
          cloud.get<CloudSocialReviewLink[]>(`${route}/review-links`, session.token),
        );
        if (
          !input.linkId ||
          !reviewLinks.some((link) => link.id === input.linkId && link.draftId === draft.id)
        )
          return yield* Effect.fail(
            new MarketingError("Review link is not part of this publishing preview.", 404),
          );
        return yield* write(
          "DELETE",
          `/v1/social/review-links/${encodeURIComponent(input.linkId)}`,
        );
      }
      if (
        input.disclosureAccepted !== true ||
        !input.expiresInHours ||
        draft.revision !== input.revision
      )
        return yield* Effect.fail(
          new MarketingError(
            "Review the exact content version and accept the sharing disclosure first.",
            409,
          ),
        );
      yield* validateMediaSources(binding);
      yield* Effect.try({
        try: () =>
          validatePublishingBinding(binding, {
            ...owner,
            campaignId: campaign.id,
            campaignRevision: campaign.revision,
            draftId: draft.id,
            cloudRevision: draft.revision,
          }),
        catch: (error) => error as MarketingError,
      });
      const created = yield* attempt(() =>
        cloud.post<CloudSocialReviewLinkCreated>(
          `${route}/review-links`,
          {
            revision: input.revision,
            expiresInHours: input.expiresInHours,
            disclosureAccepted: true,
          },
          session.token,
        ),
      );
      const reviewUrl = yield* Effect.try({
        try: () => {
          const origin = publicOrigin(created.reviewUrl);
          const target = new URL(created.reviewUrl ?? created.reviewPath, origin);
          if (
            target.origin !== origin.origin ||
            target.pathname !== "/social/review" ||
            target.hash !== new URL(created.reviewPath, origin).hash ||
            !/^#token=[A-Za-z0-9_-]{40,128}$/.test(target.hash) ||
            target.username ||
            target.password ||
            (target.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(target.hostname))
          )
            throw new Error("Invalid review website");
          return target.href;
        },
        catch: () =>
          new MarketingError(
            "The review website is unavailable. Revoke this link and ask your operator to check the DJL web address.",
            503,
          ),
      });
      return { ...created, reviewUrl };
    }
    if (input.action === "preview-media") {
      const binding = links.find((b) => b.draftId === input.draftId);
      yield* validateMediaSources(binding);
      yield* Effect.try({
        try: () =>
          validatePublishingBinding(binding, {
            ...owner,
            campaignId: campaign.id,
            campaignRevision: campaign.revision,
            draftId: input.draftId ?? "",
            cloudRevision: input.revision ?? -1,
          }),
        catch: (e) => e as MarketingError,
      });
      const mediaFiles =
        binding?.mediaFiles ??
        (binding?.mediaFileId
          ? [{ fileId: binding.mediaFileId, mimeType: binding.mediaMimeType ?? "" }]
          : []);
      if (
        !mediaFiles.length ||
        mediaFiles.some((m) => !["image/jpeg", "video/mp4"].includes(m.mimeType))
      )
        return yield* Effect.fail(
          new MarketingError("Prepare this preview again to inspect its saved media.", 409),
        );
      const draft = yield* attempt(() =>
        cloud.get<CloudSocialDraft>(
          `/v1/social/drafts/${encodeURIComponent(binding!.draftId)}`,
          session.token,
        ),
      );
      if (
        draft.revision !== binding!.cloudRevision ||
        draft.threadId !== input.threadId ||
        draft.content.mediaFileIds.length !== mediaFiles.length ||
        draft.content.mediaFileIds.some((id, index) => id !== mediaFiles[index]!.fileId)
      )
        return yield* Effect.fail(
          new MarketingError("Publishing preview changed. Review it again.", 409),
        );
      const media = [];
      for (const file of mediaFiles) {
        const download = yield* attempt(() =>
          cloud.get<{ url: string }>(
            `/v1/files/${encodeURIComponent(file.fileId)}/url`,
            session.token,
          ),
        );
        const target = yield* Effect.try({
          try: () => new URL(download.url),
          catch: () => new MarketingError("The saved media preview is unavailable.", 503),
        });
        if (
          target.username ||
          target.password ||
          (target.protocol !== "https:" &&
            !(target.protocol === "http:" && ["localhost", "127.0.0.1"].includes(target.hostname)))
        )
          return yield* Effect.fail(
            new MarketingError("The saved media preview is unavailable.", 503),
          );
        media.push({ url: target.toString(), mimeType: file.mimeType });
      }
      // Keep legacy single-media consumers compatible while exposing ordered carousel previews.
      return { ...media[0]!, ...(binding?.mediaFiles ? { media } : {}) };
    }
    if (input.action === "confirm") {
      const binding = links.find((b) => b.draftId === input.draftId);
      yield* Effect.try({
        try: () =>
          validatePublishingBinding(binding, {
            ...owner,
            campaignId: campaign.id,
            campaignRevision: campaign.revision,
            draftId: input.draftId ?? "",
            cloudRevision: input.revision ?? -1,
          }),
        catch: (e) => e as MarketingError,
      });
      const sql = yield* SqlClient.SqlClient;
      // Hold the local campaign write lock until cloud confirmation returns. Local edits
      // either win first (and this fails) or occur after the reviewed revision was confirmed.
      return yield* sql.withTransaction(
        Effect.gen(function* () {
          const locked =
            yield* sql`UPDATE marketing_documents SET version=version WHERE kind='campaign' AND id=${campaign.id} AND version=${record!.version} RETURNING version`;
          if (!locked.length)
            return yield* Effect.fail(
              new MarketingError("Campaign changed. Review the latest card.", 409),
            );
          const currentSession = yield* attempt(() => deps.session(config.secretsDir));
          if (
            !currentSession ||
            currentSession.userId !== owner.userId ||
            currentSession.orgId !== owner.orgId ||
            currentSession.apiBaseUrl !== owner.apiBaseUrl
          )
            return yield* Effect.fail(
              new MarketingError("Cloud account changed. Review the draft again.", 409),
            );
          const currentBinding = yield* readDocument("social-draft-link", input.draftId!);
          yield* Effect.try({
            try: () =>
              validatePublishingBinding(currentBinding?.value as Binding | undefined, {
                ...owner,
                campaignId: campaign.id,
                campaignRevision: campaign.revision,
                draftId: input.draftId!,
                cloudRevision: input.revision!,
              }),
            catch: (e) => e as MarketingError,
          });
          yield* validateMediaSources(currentBinding?.value as Binding | undefined);
          const legacyDraft = yield* attempt(() =>
            cloud.get<CloudSocialDraft>(
              `/v1/social/drafts/${encodeURIComponent(input.draftId!)}`,
              currentSession.token,
            ),
          );
          if (!legacyDraft.confirmedAt)
            return yield* Effect.fail(
              new MarketingError(
                "Import this unconfirmed draft into DJL MultiPost and review it again.",
                409,
              ),
            );
          return yield* attempt(() =>
            cloud.post<CloudSocialDraft>(
              `/v1/social/drafts/${encodeURIComponent(input.draftId!)}/confirm`,
              { revision: input.revision },
              currentSession.token,
            ),
          );
        }),
      );
    }
    if (!input.taskId) return yield* Effect.fail(new MarketingError("Select a publishing task."));
    const drafts = yield* attempt(() =>
      cloud.get<CloudSocialDraft[]>(
        `/v1/social/drafts?${new URLSearchParams({ threadId: input.threadId })}`,
        session.token,
      ),
    );
    const draft = drafts.find(
      (d) =>
        links.some((l) => l.draftId === d.id) &&
        d.tasks.some((t) => t.id === input.taskId && t.revision === input.revision),
    );
    if (!draft)
      return yield* Effect.fail(new MarketingError("Publishing task is missing or changed.", 404));
    if (input.action === "metrics")
      return yield* attempt(() =>
        cloud.get(`/v1/social/tasks/${encodeURIComponent(input.taskId!)}/metrics`, session.token),
      );
    if (!input.taskAction) return yield* Effect.fail(new MarketingError("Choose a task action."));
    if (input.taskAction === "retry")
      yield* Effect.try({
        try: () =>
          validatePublishingBinding(
            links.find((b) => b.draftId === draft.id),
            {
              ...owner,
              campaignId: campaign.id,
              campaignRevision: campaign.revision,
              draftId: draft.id,
              cloudRevision: input.revision!,
            },
          ),
        catch: (e) => e as MarketingError,
      });
    const actionRequest = attempt(() =>
      cloud.post(
        `/v1/social/tasks/${encodeURIComponent(input.taskId!)}/action`,
        { revision: input.revision, action: input.taskAction },
        session.token,
      ),
    );
    if (input.taskAction !== "retry") return yield* actionRequest;
    const sql = yield* SqlClient.SqlClient;
    return yield* sql.withTransaction(
      Effect.gen(function* () {
        const locked =
          yield* sql`UPDATE marketing_documents SET version=version WHERE kind='campaign' AND id=${campaign.id} AND version=${record!.version} RETURNING version`;
        if (!locked.length)
          return yield* Effect.fail(
            new MarketingError("Campaign changed. Review the latest card.", 409),
          );
        const active = yield* attempt(() => deps.session(config.secretsDir));
        if (
          !active ||
          active.userId !== owner.userId ||
          active.orgId !== owner.orgId ||
          active.apiBaseUrl !== owner.apiBaseUrl
        )
          return yield* Effect.fail(
            new MarketingError("Cloud account changed. Review again.", 409),
          );
        yield* validateMediaSources(links.find((b) => b.draftId === draft.id));
        return yield* actionRequest;
      }),
    );
  });
}
