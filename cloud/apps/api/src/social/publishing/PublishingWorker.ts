import { and, desc, eq, inArray, isNotNull, isNull, lt, lte, ne, sql } from "drizzle-orm";
import { schema, type DjlDatabase } from "@djl/db";
import { isMember } from "../../auth/guard.ts";
import type { BlobStore } from "../../sync/BlobStore.ts";
import type { SocialConnectionService } from "../SocialConnectionService.ts";
import { InstagramProvider, TikTokProvider } from "../providers/index.ts";
import { bytesMatchType } from "../../files/fileTypes.ts";
import { inspectMp4 } from "./mp4.ts";
const tasks = schema.socialPublishTasks;
const drafts = schema.socialDrafts;
type Task = typeof tasks.$inferSelect;
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
          if (reconcile && !task.remoteId) {
            await update({
              state: "uncertain",
              errorCode: "manual_reconciliation_required",
              dueAt: new Date(Date.now() + 3600000),
            });
            return;
          }
          let remoteId = task.remoteId;
          if (!remoteId) {
            const [file] = await this.db
              .select()
              .from(schema.files)
              .where(
                and(
                  eq(schema.files.id, content.mediaFileIds[0]!),
                  eq(schema.files.orgId, task.orgId),
                  eq(schema.files.userId, task.userId),
                  eq(schema.files.status, "ready"),
                  isNull(schema.files.deletedAt),
                ),
              );
            if (!file) {
              await update({ state: "failed", errorCode: "media_unavailable" });
              return;
            }
            const verifiedBytes = await this.blobs.read(file.storageKey);
            const digest = verifiedBytes
              ? Buffer.from(
                  await crypto.subtle.digest("SHA-256", verifiedBytes as BufferSource),
                ).toString("hex")
              : null;
            if (
              !verifiedBytes ||
              verifiedBytes.byteLength !== file.sizeBytes ||
              digest !== file.sha256 ||
              !bytesMatchType(file.mimeType, verifiedBytes)
            ) {
              await update({ state: "failed", errorCode: "media_changed" });
              return;
            }
            // Client upload URLs can still overwrite files/{id} after completion. Publish only
            // this server-owned snapshot, durably addressed by task ID and verified SHA-256.
            const snapshotKey = `org/${task.orgId}/social-publish/${task.id}/${digest}`;
            await this.blobs.write(snapshotKey, verifiedBytes, file.mimeType);
            // TikTok can spend up to an hour pulling media; allow initialization/pull margin.
            const { url } = await this.blobs.presignDownload(snapshotKey, 7200);
            if (provider instanceof InstagramProvider) {
              remoteId = (
                await provider.createContainer(
                  tokens,
                  providerAccountId,
                  file.mimeType === "video/mp4"
                    ? { videoUrl: url, caption: content.captions[task.accountId]! }
                    : { imageUrl: url, caption: content.captions[task.accountId]! },
                )
              ).containerId;
              await update({ remoteId });
            } else if (provider instanceof TikTokProvider && content.tiktokOptions) {
              const metadata = inspectMp4(verifiedBytes);
              const creator = await provider.creatorInfo(tokens);
              if (!metadata || metadata.durationSeconds > creator.maxVideoDurationSeconds) {
                await update({ state: "failed", errorCode: "media_inspection_required" });
                return;
              }
              await update({ publishStartedAt: new Date() });
              remoteId = (
                await provider.publishVideo(tokens, {
                  ...content.tiktokOptions,
                  videoUrl: url,
                  title: content.captions[task.accountId]!,
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
