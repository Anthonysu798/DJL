import { and, desc, eq, inArray, isNotNull, isNull, lt, lte, ne, sql } from "drizzle-orm";
import { schema, type DjlDatabase } from "@djl/db";
import { isMember } from "../../auth/guard.ts";
import type { BlobStore } from "../../sync/BlobStore.ts";
import type { SocialConnectionService } from "../SocialConnectionService.ts";
import { InstagramProvider, TikTokProvider, inspectTikTokJpeg } from "../providers/index.ts";
import { bytesMatchType } from "../../files/fileTypes.ts";
import { inspectMp4 } from "./mp4.ts";
const tasks = schema.socialPublishTasks;
const drafts = schema.socialDrafts;
type Task = typeof tasks.$inferSelect;
type Snapshot = { key: string; mimeType: string; sha256: string; sizeBytes: number };
type CarouselReceipt = {
  kind: "instagram-carousel-v1";
  snapshots: Snapshot[];
  children: string[];
  pending: boolean;
  parentId?: string;
};
function carouselReceipt(remoteId: string | null): CarouselReceipt | null {
  if (!remoteId?.startsWith("{")) return null;
  const receipt = JSON.parse(remoteId) as CarouselReceipt;
  if (
    receipt.kind !== "instagram-carousel-v1" ||
    !Array.isArray(receipt.children) ||
    !Array.isArray(receipt.snapshots)
  )
    throw new Error("Invalid carousel receipt");
  return receipt;
}
/** DB rows are the durable queue. A periodic sweep repairs missed notifications and process death. */
export class PublishingWorker {
  constructor(
    private readonly db: DjlDatabase,
    private readonly accounts: SocialConnectionService,
    private readonly blobs: BlobStore,
  ) {}
  async due(): Promise<string[]> {
    const now = new Date();
    // A crashed writer may already have published. Never put it back in queued.
    await this.db
      .update(tasks)
      .set({ state: "uncertain", updatedAt: now, errorCode: "interrupted" })
      .where(
        and(
          inArray(tasks.state, ["publishing", "reconciling"]),
          lt(tasks.updatedAt, new Date(Date.now() - 300000)),
        ),
      );
    return (
      await this.db
        .select({ id: tasks.id })
        .from(tasks)
        .where(and(inArray(tasks.state, ["queued", "uncertain"]), lte(tasks.dueAt, now)))
        .limit(100)
    ).map((r) => r.id);
  }
  async execute(id: string): Promise<void> {
    const [found] = await this.db.select().from(tasks).where(eq(tasks.id, id));
    if (!found || !["queued", "uncertain"].includes(found.state)) return;
    const claim = await this.db.transaction(async (tx) => {
      // Contention may retry the DB claim, never a provider write. Bound lock waiting.
      await tx.execute(sql`set local lock_timeout = '5s'`);
      const [draft] = await tx
        .select()
        .from(drafts)
        .where(eq(drafts.id, found.draftId))
        .for("update");
      if (!draft || draft.revision !== found.revision || !draft.confirmedAt) return;
      // Serialize claim reservations per connected account across worker processes.
      // This is conservative pacing, not a guarantee of platform-wide rate limits.
      const [account] = await tx
        .select({ id: schema.socialAccounts.id })
        .from(schema.socialAccounts)
        .where(eq(schema.socialAccounts.id, found.accountId))
        .for("update");
      if (!account) return;
      const [previous] = await tx
        .select({ updatedAt: tasks.updatedAt })
        .from(tasks)
        .where(
          and(eq(tasks.accountId, found.accountId), ne(tasks.id, id), isNotNull(tasks.attemptId)),
        )
        .orderBy(desc(tasks.updatedAt))
        .limit(1);
      const availableAt = previous ? previous.updatedAt.getTime() + 60000 : 0;
      if (availableAt > Date.now()) {
        await tx
          .update(tasks)
          .set({ dueAt: new Date(availableAt) })
          .where(and(eq(tasks.id, id), eq(tasks.state, found.state)));
        return;
      }
      const [task] = await tx
        .update(tasks)
        .set({
          state: found.state === "queued" ? "publishing" : "reconciling",
          attemptId: crypto.randomUUID(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(tasks.id, id),
            eq(tasks.state, found.state),
            inArray(tasks.state, ["queued", "uncertain"]),
            lte(tasks.dueAt, new Date()),
          ),
        )
        .returning();
      return task
        ? { task, content: draft.content, reconcile: found.state !== "queued" }
        : undefined;
    });
    if (!claim) return;
    const { task, content, reconcile } = claim;
    const update = async (patch: Partial<Task>) => {
      const [row] = await this.db
        .update(tasks)
        .set({ ...patch, updatedAt: new Date() })
        .where(and(eq(tasks.id, id), eq(tasks.attemptId, task.attemptId!)))
        .returning();
      if (!row) throw new Error("Social task lease lost");
    };
    try {
      // Scheduled jobs have no fresh HTTP principal; apply the same suspension gate as auth.
      const [owner] = await this.db
        .select({ banned: schema.user.banned })
        .from(schema.user)
        .where(eq(schema.user.id, task.userId));
      if (!owner || owner.banned) {
        await update({
          state: reconcile ? "uncertain" : "failed",
          errorCode: "owner_unavailable",
          dueAt: new Date(Date.now() + 3600000),
        });
        return;
      }
      if (!(await isMember(this.db, task.userId, task.orgId))) {
        await update({
          state: reconcile ? "uncertain" : "failed",
          errorCode: "membership_revoked",
          dueAt: new Date(Date.now() + 3600000),
        });
        return;
      }
      await this.accounts.withAccountCredentials(
        task,
        task.accountId,
        async ({ provider, tokens, providerAccountId }) => {
          let receipt = carouselReceipt(task.remoteId);
          if ((reconcile && !task.remoteId) || receipt?.pending) {
            await update({
              state: "uncertain",
              errorCode: "manual_reconciliation_required",
              dueAt: new Date(Date.now() + 3600000),
            });
            return;
          }
          let remoteId = receipt ? (receipt.parentId ?? null) : task.remoteId;
          if (!remoteId) {
            const snapshots: Snapshot[] = receipt?.snapshots ?? [];
            if (receipt) {
              const references = await this.db
                .select()
                .from(schema.files)
                .where(
                  and(
                    inArray(schema.files.id, content.mediaFileIds),
                    eq(schema.files.orgId, task.orgId),
                    eq(schema.files.userId, task.userId),
                    eq(schema.files.status, "ready"),
                    isNull(schema.files.deletedAt),
                  ),
                );
              if (
                references.length !== content.mediaFileIds.length ||
                snapshots.length !== content.mediaFileIds.length ||
                content.mediaFileIds.some((fileId, index) => {
                  const file = references.find((row) => row.id === fileId);
                  const snapshot = snapshots[index]!;
                  return (
                    !file ||
                    file.sha256 !== snapshot.sha256 ||
                    file.mimeType !== snapshot.mimeType ||
                    file.sizeBytes !== snapshot.sizeBytes
                  );
                })
              ) {
                await update({ state: "failed", errorCode: "media_unavailable" });
                return;
              }
            }
            if (!receipt) {
              // Verify every selected file before making any provider write. Query result order
              // is unspecified; the confirmed mediaFileIds array determines the carousel order.
              const files = await this.db
                .select()
                .from(schema.files)
                .where(
                  and(
                    inArray(schema.files.id, content.mediaFileIds),
                    eq(schema.files.orgId, task.orgId),
                    eq(schema.files.userId, task.userId),
                    eq(schema.files.status, "ready"),
                    isNull(schema.files.deletedAt),
                  ),
                );
              const ordered = content.mediaFileIds.map((fileId) =>
                files.find((f) => f.id === fileId),
              );
              if (
                ordered.some((f) => !f) ||
                !ordered.length ||
                ordered.length > 35 ||
                new Set(content.mediaFileIds).size !== ordered.length
              ) {
                await update({ state: "failed", errorCode: "media_unavailable" });
                return;
              }
              if (
                (ordered.length > 1 && ordered.some((f) => f!.mimeType !== "image/jpeg")) ||
                (provider instanceof InstagramProvider && ordered.length > 10)
              ) {
                await update({ state: "failed", errorCode: "media_unsupported" });
                return;
              }
              for (const file of ordered) {
                const bytes = await this.blobs.read(file!.storageKey);
                const digest = bytes
                  ? Buffer.from(
                      await crypto.subtle.digest("SHA-256", bytes as BufferSource),
                    ).toString("hex")
                  : null;
                if (
                  !bytes ||
                  bytes.byteLength !== file!.sizeBytes ||
                  digest !== file!.sha256 ||
                  !bytesMatchType(file!.mimeType, bytes)
                ) {
                  await update({ state: "failed", errorCode: "media_changed" });
                  return;
                }
                const key = `org/${task.orgId}/social-publish/${task.id}/${digest}`;
                await this.blobs.write(key, bytes, file!.mimeType);
                snapshots.push({
                  key,
                  mimeType: file!.mimeType,
                  sha256: digest!,
                  sizeBytes: bytes.byteLength,
                });
              }
              if (provider instanceof InstagramProvider && snapshots.length > 1) {
                receipt = {
                  kind: "instagram-carousel-v1",
                  snapshots,
                  children: [],
                  pending: false,
                };
                await update({ remoteId: JSON.stringify(receipt) });
              }
            }
            // Resume preparation from server-owned snapshots, never mutable client upload URLs.
            const media = [];
            for (const snapshot of snapshots) {
              const bytes = await this.blobs.read(snapshot.key);
              if (
                !bytes ||
                bytes.byteLength !== snapshot.sizeBytes ||
                Buffer.from(await crypto.subtle.digest("SHA-256", bytes as BufferSource)).toString(
                  "hex",
                ) !== snapshot.sha256 ||
                !bytesMatchType(snapshot.mimeType, bytes)
              ) {
                await update({
                  state: receipt ? "uncertain" : "failed",
                  errorCode: "media_changed",
                });
                return;
              }
              const { url } = await this.blobs.presignDownload(snapshot.key, 7200);
              media.push({ ...snapshot, bytes, url });
            }
            const first = media[0]!;
            if (provider instanceof InstagramProvider) {
              if (receipt) {
                while (receipt.children.length < media.length) {
                  // Persist intent before each non-idempotent request. An unknown response
                  // must be investigated; it is never interpreted as permission to recreate.
                  receipt.pending = true;
                  await update({ remoteId: JSON.stringify(receipt) });
                  const child = await provider.createContainer(tokens, providerAccountId, {
                    imageUrl: media[receipt.children.length]!.url,
                    caption: "",
                    carouselItem: true,
                  });
                  receipt.children.push(child.containerId);
                  receipt.pending = false;
                  await update({ remoteId: JSON.stringify(receipt) });
                }
                for (const childId of receipt.children) {
                  const state = await provider.containerStatus(tokens, childId);
                  if (state === "failed") {
                    await update({ state: "failed", errorCode: "provider_rejected" });
                    return;
                  }
                  if (state !== "ready") {
                    await update({
                      state: "uncertain",
                      errorCode: "awaiting_provider",
                      dueAt: new Date(Date.now() + 60000),
                    });
                    return;
                  }
                }
                receipt.pending = true;
                await update({ remoteId: JSON.stringify(receipt) });
                remoteId = (
                  await provider.createContainer(tokens, providerAccountId, {
                    childContainerIds: receipt.children,
                    caption: content.captions[task.accountId]!,
                  })
                ).containerId;
                receipt.parentId = remoteId;
                receipt.pending = false;
                await update({ remoteId: JSON.stringify(receipt) });
              } else {
                remoteId = (
                  await provider.createContainer(
                    tokens,
                    providerAccountId,
                    first.mimeType === "video/mp4"
                      ? { videoUrl: first.url, caption: content.captions[task.accountId]! }
                      : { imageUrl: first.url, caption: content.captions[task.accountId]! },
                  )
                ).containerId;
                await update({ remoteId });
              }
            } else if (provider instanceof TikTokProvider && content.tiktokOptions) {
              const isVideo = first.mimeType === "video/mp4";
              const metadata = isVideo ? inspectMp4(first.bytes) : null;
              const creator = await provider.creatorInfo(tokens);
              if (
                isVideo
                  ? !metadata || metadata.durationSeconds > creator.maxVideoDurationSeconds
                  : media.some((m) => m.mimeType !== "image/jpeg" || !inspectTikTokJpeg(m.bytes))
              ) {
                await update({ state: "failed", errorCode: "media_inspection_required" });
                return;
              }
              const options = content.tiktokOptions;
              const caption = content.captions[task.accountId]!;
              const cover = options.photoCoverIndex ?? 0;
              if (
                !options.musicUsageConfirmed ||
                caption.length > (isVideo ? 2200 : 4000) ||
                !Number.isInteger(cover) ||
                cover < 0 ||
                cover >= media.length ||
                !creator.privacyLevels.includes(options.privacyLevel) ||
                (options.brandContent && options.privacyLevel === "SELF_ONLY") ||
                (creator.commentDisabled && !options.disableComment) ||
                (isVideo && creator.duetDisabled && !options.disableDuet) ||
                (isVideo && creator.stitchDisabled && !options.disableStitch)
              ) {
                await update({ state: "failed", errorCode: "invalid_tiktok_options" });
                return;
              }
              await update({ publishStartedAt: new Date() });
              remoteId = (
                isVideo
                  ? await provider.publishVideo(tokens, {
                      ...options,
                      videoUrl: first.url,
                      title: caption,
                    })
                  : await provider.publishPhoto(tokens, {
                      ...options,
                      photoUrls: media.map((m) => m.url),
                      description: caption,
                    })
              ).publishId;
              await update({ remoteId });
            } else {
              await update({ state: "failed", errorCode: "provider_unavailable" });
              return;
            }
          }
          if (provider instanceof InstagramProvider) {
            const state = await provider.containerStatus(tokens, remoteId);
            if (state === "published") {
              await update({ state: "published", errorCode: null });
              return;
            }
            if (state === "failed") {
              await update({ state: "failed", errorCode: "provider_rejected" });
              return;
            }
            if (state === "ready" && !task.publishStartedAt) {
              await update({ publishStartedAt: new Date() });
              const result = await provider.publishContainer(tokens, providerAccountId, remoteId);
              await update({ state: "published", postId: result.postId, errorCode: null });
              return;
            }
          } else if (provider instanceof TikTokProvider) {
            const result = await provider.status(tokens, remoteId);
            if (result.state === "published") {
              await update({
                state: "published",
                postId: result.postIds[0] ?? null,
                errorCode: null,
              });
              return;
            }
            if (result.state === "failed") {
              await update({ state: "failed", errorCode: "provider_rejected" });
              return;
            }
          }
          await update({
            state: "uncertain",
            errorCode: "awaiting_provider",
            dueAt: new Date(Date.now() + 60000),
          });
        },
      );
    } catch {
      // Even an unexpected exception may occur after the upstream accepted a write.
      // Only a terminal provider status or a local pre-write check permits retry.
      await update({
        state: "uncertain",
        errorCode: "publication_uncertain",
        dueAt: new Date(Date.now() + 60000),
      });
    }
  }
}
