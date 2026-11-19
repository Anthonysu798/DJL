import { and, eq, inArray, isNull } from "drizzle-orm";
import { schema, type DjlDatabase } from "@djl/db";
import type { CloudSocialDraftInput } from "@synara/contracts/cloud";
import type { BlobStore } from "../../sync/BlobStore.ts";
import type { SocialConnectionService } from "../SocialConnectionService.ts";
import { InstagramProvider, TikTokProvider, inspectTikTokJpeg } from "../providers/index.ts";
import { inspectMp4 } from "./mp4.ts";
import { ApiError } from "../../http/errors.ts";

type Scope = { userId: string; orgId: string };
const drafts = schema.socialDrafts;
const tasks = schema.socialPublishTasks;
const missing = () => new ApiError(404, "not_found", "Not found.");
const conflict = () =>
  new ApiError(409, "stale_revision", "Review the latest draft before continuing.");
const owned = (p: Scope) => and(eq(drafts.orgId, p.orgId), eq(drafts.userId, p.userId));
export function validateDraft(input: CloudSocialDraftInput): void {
  if (input.tiktokOptions && !input.tiktokOptions.musicUsageConfirmed)
    throw new ApiError(
      400,
      "music_consent_required",
      "Confirm TikTok music usage before publishing.",
    );
  if (
    !input.threadId ||
    input.threadId.length > 200 ||
    input.caption.length > 4000 ||
    Object.values(input.captions).some((c) => c.length > 4000) ||
    input.accountIds.some((id) => typeof input.captions[id] !== "string") ||
    input.mediaFileIds.length < 1 ||
    input.mediaFileIds.length > 35 ||
    new Set(input.mediaFileIds).size !== input.mediaFileIds.length ||
    (input.tiktokOptions?.photoCoverIndex !== undefined &&
      (!Number.isInteger(input.tiktokOptions.photoCoverIndex) ||
        input.tiktokOptions.photoCoverIndex < 0 ||
        input.tiktokOptions.photoCoverIndex >= input.mediaFileIds.length)) ||
    input.accountIds.length < 1 ||
    input.accountIds.length > 10 ||
    new Set(input.accountIds).size !== input.accountIds.length ||
    !Number.isFinite(Date.parse(input.scheduledAt)) ||
    !/(Z|[+-]\d\d:\d\d)$/.test(input.scheduledAt)
  )
    throw new ApiError(
      400,
      "invalid_draft",
      "Choose ordered media files, accounts, and a valid scheduled instant.",
    );
  try {
    new Intl.DateTimeFormat("en", { timeZone: input.timezone }).resolvedOptions();
  } catch {
    throw new ApiError(400, "invalid_timezone", "Choose an IANA timezone.");
  }
}
export class PublishingService {
  constructor(
    private readonly db: DjlDatabase,
    private readonly blobs?: BlobStore,
    private readonly connections?: SocialConnectionService,
  ) {}
  async create(p: Scope, input: CloudSocialDraftInput) {
    validateDraft(input);
    await this.validateReferences(p, input);
    const { threadId, ...content } = input;
    const [row] = await this.db
      .insert(drafts)
      .values({
        ...p,
        threadId,
        revision: 1,
        content: {
          ...content,
          mediaFileIds: [...content.mediaFileIds],
          accountIds: [...content.accountIds],
        },
      })
      .returning();
    return this.get(p, row!.id);
  }
  async list(p: Scope, threadId: string) {
    const rows = await this.db
      .select({ id: drafts.id })
      .from(drafts)
      .where(and(owned(p), eq(drafts.threadId, threadId)));
    return Promise.all(rows.map((r) => this.get(p, r.id)));
  }
  async get(p: Scope, id: string) {
    const [draft] = await this.db
      .select()
      .from(drafts)
      .where(and(eq(drafts.id, id), owned(p)));
    if (!draft) throw missing();
    const rows = await this.db
      .select()
      .from(tasks)
      .where(and(eq(tasks.draftId, id), eq(tasks.orgId, p.orgId), eq(tasks.userId, p.userId)));
    return {
      ...draft,
      tasks: rows.map(({ attemptId: _attempt, remoteId: _remote, ...row }) => row),
    };
  }
  async edit(p: Scope, id: string, revision: number, input: CloudSocialDraftInput) {
    validateDraft(input);
    await this.validateReferences(p, input);
    await this.db.transaction(async (tx) => {
      const [draft] = await tx
        .select()
        .from(drafts)
        .where(and(eq(drafts.id, id), owned(p)))
        .for("update");
      if (!draft) throw missing();
      if (draft.revision !== revision) throw conflict();
      const running = await tx
        .select()
        .from(tasks)
        .where(
          and(
            eq(tasks.draftId, id),
            inArray(tasks.state, ["publishing", "reconciling", "uncertain", "published"]),
          ),
        );
      if (running.length)
        throw new ApiError(
          409,
          "publication_pending",
          "Processing or published posts cannot be edited here. Resolve pending results or create a new draft.",
        );
      const { threadId, ...content } = input;
      await tx
        .update(drafts)
        .set({
          threadId,
          revision: revision + 1,
          content: {
            ...content,
            mediaFileIds: [...content.mediaFileIds],
            accountIds: [...content.accountIds],
          },
          confirmedAt: null,
          updatedAt: new Date(),
        })
        .where(eq(drafts.id, id));
      await tx
        .update(tasks)
        .set({ state: "cancelled", updatedAt: new Date() })
        .where(and(eq(tasks.draftId, id), inArray(tasks.state, ["queued", "failed"])));
    });
    return this.get(p, id);
  }
  /** Called only by the authenticated human-action route, never a model tool. */
  async confirm(p: Scope, id: string, revision: number) {
    await this.db.transaction(async (tx) => {
      const [draft] = await tx
        .select()
        .from(drafts)
        .where(and(eq(drafts.id, id), owned(p)))
        .for("update");
      if (!draft) throw missing();
      if (draft.revision !== revision) throw conflict();
      if (draft.confirmedAt) return;
      await this.validateReferences(p, { threadId: draft.threadId, ...draft.content });
      const confirmedAt = new Date();
      if (
        draft.content.publicationMode !== "now" &&
        Date.parse(draft.content.scheduledAt) <= confirmedAt.getTime()
      )
        throw new ApiError(
          400,
          "schedule_expired",
          "Choose a future publishing time and review the draft again.",
        );
      await tx.update(drafts).set({ confirmedAt }).where(eq(drafts.id, id));
      await tx.insert(tasks).values(
        draft.content.accountIds.map((accountId) => ({
          draftId: id,
          userId: p.userId,
          orgId: p.orgId,
          revision,
          accountId,
          state: "queued" as const,
          dueAt:
            draft.content.publicationMode === "now"
              ? confirmedAt
              : new Date(draft.content.scheduledAt),
        })),
      );
    });
    return this.get(p, id);
  }
  async action(p: Scope, id: string, revision: number, action: "cancel" | "retry") {
    // Serialize against edit and worker claim using the draft lock, in the same order.
    const [target] = await this.db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, id), eq(tasks.orgId, p.orgId), eq(tasks.userId, p.userId)));
    if (!target) throw missing();
    await this.db.transaction(async (tx) => {
      const [draft] = await tx
        .select()
        .from(drafts)
        .where(and(eq(drafts.id, target.draftId), owned(p)))
        .for("update");
      if (!draft || draft.revision !== revision || target.revision !== revision) throw conflict();
      const [changed] = await tx
        .update(tasks)
        .set({
          state: action === "cancel" ? "cancelled" : "queued",
          dueAt: new Date(),
          errorCode: null,
          ...(action === "retry" ? { remoteId: null, postId: null, publishStartedAt: null } : {}),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(tasks.id, id),
            inArray(tasks.state, action === "cancel" ? ["queued", "failed"] : ["failed"]),
          ),
        )
        .returning();
      if (!changed)
        throw new ApiError(
          409,
          "task_not_actionable",
          "This publication cannot be changed or safely retried.",
        );
    });
    return this.get(p, target.draftId);
  }
  async metrics(p: Scope, id: string) {
    const [task] = await this.db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, id), eq(tasks.orgId, p.orgId), eq(tasks.userId, p.userId)));
    if (!task) throw missing();
    const unavailable = {
      postUrl: null,
      metrics: { views: null, likes: null, comments: null, shares: null },
    };
    if (task.state !== "published" || !task.postId || !this.connections) return unavailable;
    return this.connections.withAccountCredentials(
      p,
      task.accountId,
      async ({ provider, tokens }) => {
        if (!(provider instanceof InstagramProvider) && !(provider instanceof TikTokProvider))
          return unavailable;
        const [metrics, postUrl] = await Promise.all([
          provider.metrics(tokens, task.postId!).catch(() => unavailable.metrics),
          provider.postUrl(tokens, task.postId!).catch(() => null),
        ]);
        return { metrics, postUrl };
      },
    );
  }
  private async validateReferences(p: Scope, input: CloudSocialDraftInput) {
    const accounts = await this.db
      .select()
      .from(schema.socialAccounts)
      .where(
        and(
          inArray(schema.socialAccounts.id, [...input.accountIds]),
          eq(schema.socialAccounts.orgId, p.orgId),
          eq(schema.socialAccounts.userId, p.userId),
          eq(schema.socialAccounts.status, "connected"),
        ),
      );
    if (
      accounts.length !== input.accountIds.length ||
      accounts.some((a) => !a.capabilities.publish)
    )
      throw new ApiError(400, "account_unavailable", "Reconnect a publishing-capable account.");
    if (accounts.filter((a) => a.provider === "tiktok").length > 1)
      throw new ApiError(400, "multiple_tiktok_accounts", "Review one TikTok account at a time.");
    const media = await this.db
      .select()
      .from(schema.files)
      .where(
        and(
          inArray(schema.files.id, [...input.mediaFileIds]),
          eq(schema.files.orgId, p.orgId),
          eq(schema.files.userId, p.userId),
          eq(schema.files.status, "ready"),
          isNull(schema.files.deletedAt),
        ),
      );
    if (media.length !== input.mediaFileIds.length)
      throw new ApiError(
        400,
        "media_unavailable",
        "Upload and verify the media in DJL Cloud first.",
      );
    // Only owned, verified uploads reach provider fetches; no arbitrary URLs.
    if (
      media.some((f) => f.mimeType !== "image/jpeg" && f.mimeType !== "video/mp4") ||
      (accounts.some((a) => a.provider === "tiktok") && !input.tiktokOptions)
    )
      throw new ApiError(
        400,
        "media_unsupported",
        "Use JPEG or MP4 with explicit publishing options for TikTok.",
      );
    if (accounts.some((a) => a.provider === "instagram") && media.length > 10)
      throw new ApiError(400, "media_limit", "Instagram supports up to 10 images per carousel.");
    if (media.length > 1 && media.some((f) => f.mimeType !== "image/jpeg"))
      throw new ApiError(
        400,
        "media_unsupported",
        "Carousels support JPEG images only. Publish a video separately.",
      );
    for (const file of media) {
      const isVideo = file.mimeType === "video/mp4";
      const hasTikTok = accounts.some((a) => a.provider === "tiktok");
      const bytes = isVideo || hasTikTok ? await this.blobs?.read(file.storageKey) : null;
      const metadata = isVideo && bytes ? inspectMp4(bytes) : null;
      if (isVideo && !metadata)
        throw new ApiError(
          400,
          "media_inspection_required",
          "Video metadata must contain one supported AVC/HEVC video track and a valid duration.",
        );
      if (hasTikTok && !isVideo && (!bytes || !inspectTikTokJpeg(bytes)))
        throw new ApiError(
          400,
          "media_inspection_required",
          "TikTok requires a JPEG up to 20 MB with a short edge up to 1080 and long edge up to 1920 pixels.",
        );
      if (
        accounts.some(
          (a) => input.captions[a.id]!.length > (a.provider === "tiktok" && !isVideo ? 4000 : 2200),
        )
      )
        throw new ApiError(400, "invalid_draft", "The caption exceeds this account's media limit.");
      for (const account of accounts.filter((a) => a.provider === "tiktok")) {
        if (!this.connections)
          throw new ApiError(503, "provider_unavailable", "Social publishing is unavailable.");
        await this.connections.withAccountCredentials(
          p,
          account.id,
          async ({ provider, tokens }) => {
            if (!(provider instanceof TikTokProvider))
              throw new ApiError(503, "provider_unavailable", "Social publishing is unavailable.");
            const info = await provider.creatorInfo(tokens);
            const options = input.tiktokOptions;
            if (
              !options ||
              (metadata && metadata.durationSeconds > info.maxVideoDurationSeconds) ||
              !info.privacyLevels.includes(options.privacyLevel) ||
              (options.brandContent && options.privacyLevel === "SELF_ONLY") ||
              (isVideo && info.duetDisabled && !options.disableDuet) ||
              (isVideo && info.stitchDisabled && !options.disableStitch) ||
              (info.commentDisabled && !options.disableComment)
            )
              throw new ApiError(
                400,
                "invalid_tiktok_options",
                "Review the creator's privacy, interaction settings, and media limits.",
              );
          },
        );
      }
    }
  }
}
