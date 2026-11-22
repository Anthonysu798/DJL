import { createHash, randomBytes } from "node:crypto";
import { and, eq, inArray, isNull, asc } from "drizzle-orm";
import { schema, type DjlDatabase } from "@djl/db";
import type {
  CloudSocialReviewLinkInput,
  CloudSocialReviewFeedbackInput,
} from "@djl/contracts/cloud";
import type { BlobStore } from "../../sync/BlobStore.ts";
import { ApiError } from "../../http/errors.ts";

type Scope = { userId: string; orgId: string };
const links = schema.socialReviewLinks;
const drafts = schema.socialDrafts;
const feedback = schema.socialReviewFeedback;
const owned = (p: Scope) => and(eq(drafts.orgId, p.orgId), eq(drafts.userId, p.userId));
const linkOwned = (p: Scope) => and(eq(links.orgId, p.orgId), eq(links.userId, p.userId));
const missing = () =>
  new ApiError(404, "review_unavailable", "This review link is unavailable or expired.");
const stale = () =>
  new ApiError(409, "stale_revision", "The draft changed. Ask the owner for a new review link.");
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const iso = (date: Date) => date.toISOString();

export class ReviewLinkService {
  constructor(
    private readonly db: DjlDatabase,
    private readonly blobs: BlobStore,
    private readonly now = () => new Date(),
  ) {}

  async create(p: Scope, draftId: string, input: CloudSocialReviewLinkInput) {
    if (!input.disclosureAccepted)
      throw new ApiError(
        400,
        "disclosure_required",
        "Confirm that anyone with this link can view the caption and media and submit feedback.",
      );
    if (![24, 72, 168].includes(input.expiresInHours) || !Number.isInteger(input.revision))
      throw new ApiError(400, "invalid_review_link", "Choose a review expiry of 1, 3, or 7 days.");
    const token = randomBytes(32).toString("base64url");
    const id = await this.db.transaction(async (tx) => {
      const [draft] = await tx
        .select()
        .from(drafts)
        .where(and(eq(drafts.id, draftId), owned(p)))
        .for("update");
      if (!draft) throw missing();
      if (draft.revision !== input.revision) throw stale();
      const files = await tx
        .select()
        .from(schema.files)
        .where(
          and(
            inArray(schema.files.id, draft.content.mediaFileIds),
            eq(schema.files.orgId, p.orgId),
            eq(schema.files.userId, p.userId),
            eq(schema.files.status, "ready"),
            isNull(schema.files.deletedAt),
          ),
        );
      const accounts = await tx
        .select()
        .from(schema.socialAccounts)
        .where(
          and(
            inArray(schema.socialAccounts.id, draft.content.accountIds),
            eq(schema.socialAccounts.orgId, p.orgId),
            eq(schema.socialAccounts.userId, p.userId),
          ),
        );
      if (
        files.length !== draft.content.mediaFileIds.length ||
        accounts.length !== draft.content.accountIds.length
      )
        throw missing();
      const media = [];
      for (const id of draft.content.mediaFileIds) {
        const file = files.find((file) => file.id === id)!;
        const bytes = await this.blobs.read(file.storageKey);
        if (
          !bytes ||
          !file.sha256 ||
          hash(bytes) !== file.sha256 ||
          !["image/jpeg", "video/mp4"].includes(file.mimeType)
        )
          throw missing();
        media.push({
          fileId: file.id,
          storageKey: file.storageKey,
          sha256: file.sha256,
          mimeType: file.mimeType,
        });
      }
      const createdAt = this.now();
      const [link] = await tx
        .insert(links)
        .values({
          ...p,
          draftId,
          revision: draft.revision,
          tokenHash: hash(token),
          createdAt,
          expiresAt: new Date(createdAt.getTime() + input.expiresInHours * 3600000),
          snapshot: {
            caption: draft.content.caption,
            targets: draft.content.accountIds.map((id) => ({
              provider: accounts.find((a) => a.id === id)!.provider,
              caption: draft.content.captions[id] ?? draft.content.caption,
            })),
            media,
            publicationMode: draft.content.publicationMode ?? "scheduled",
            scheduledAt: draft.content.scheduledAt,
            timezone: draft.content.timezone,
          },
        })
        .returning({ id: links.id });
      return link!.id;
    });
    const link = (await this.list(p, draftId)).find((link) => link.id === id)!;
    return { link, token, reviewPath: `/social/review#token=${token}` };
  }

  async list(p: Scope, draftId: string) {
    const [draft] = await this.db
      .select()
      .from(drafts)
      .where(and(eq(drafts.id, draftId), owned(p)));
    if (!draft) throw missing();
    const rows = await this.db
      .select()
      .from(links)
      .where(and(eq(links.draftId, draftId), linkOwned(p)))
      .orderBy(asc(links.createdAt));
    return Promise.all(
      rows.map(async (link) => ({
        id: link.id,
        draftId: link.draftId,
        revision: link.revision,
        createdAt: iso(link.createdAt),
        expiresAt: iso(link.expiresAt),
        revokedAt: link.revokedAt ? iso(link.revokedAt) : null,
        isCurrent: draft.revision === link.revision,
        feedback: (
          await this.db
            .select()
            .from(feedback)
            .where(eq(feedback.linkId, link.id))
            .orderBy(asc(feedback.createdAt))
        ).map((entry) => ({
          id: entry.id,
          reviewerName: entry.reviewerName,
          comment: entry.comment,
          decision: entry.decision,
          identityVerified: false as const,
          createdAt: iso(entry.createdAt),
        })),
      })),
    );
  }

  async revoke(p: Scope, id: string) {
    const [link] = await this.db
      .update(links)
      .set({ revokedAt: this.now() })
      .where(and(eq(links.id, id), linkOwned(p)))
      .returning({ id: links.id });
    if (!link) throw missing();
    return { id: link.id, revoked: true };
  }

  private async active(token: string) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw missing();
    const [link] = await this.db
      .select()
      .from(links)
      .where(eq(links.tokenHash, hash(token)));
    if (!link || link.revokedAt || link.expiresAt <= this.now()) throw missing();
    const [draft] = await this.db
      .select()
      .from(drafts)
      .where(
        and(
          eq(drafts.id, link.draftId),
          eq(drafts.orgId, link.orgId),
          eq(drafts.userId, link.userId),
        ),
      );
    if (!draft) throw missing();
    return { link, isCurrent: draft.revision === link.revision };
  }

  async read(token: string) {
    const { link, isCurrent } = await this.active(token);
    const { snapshot } = link;
    return {
      revision: link.revision,
      isCurrent,
      expiresAt: iso(link.expiresAt),
      caption: snapshot.caption,
      targets: snapshot.targets,
      media: snapshot.media.map((media, index) => ({ index, mimeType: media.mimeType })),
      publicationMode: snapshot.publicationMode,
      scheduledAt: snapshot.scheduledAt,
      timezone: snapshot.timezone,
    };
  }

  async media(token: string, index: number) {
    const { link } = await this.active(token);
    if (!Number.isInteger(index) || index < 0) throw missing();
    const media = link.snapshot.media[index];
    if (!media) throw missing();
    const [file] = await this.db
      .select()
      .from(schema.files)
      .where(
        and(
          eq(schema.files.id, media.fileId),
          eq(schema.files.orgId, link.orgId),
          eq(schema.files.userId, link.userId),
          eq(schema.files.status, "ready"),
          isNull(schema.files.deletedAt),
        ),
      );
    if (!file || file.storageKey !== media.storageKey || file.sha256 !== media.sha256)
      throw missing();
    const bytes = await this.blobs.read(media.storageKey);
    if (!bytes || hash(bytes) !== media.sha256) throw missing();
    // Storage IO may outlive an expiry or an owner revocation. Check again before returning bytes.
    await this.active(token);
    return { bytes, mimeType: media.mimeType };
  }

  async submit(token: string, input: CloudSocialReviewFeedbackInput) {
    const name = input.reviewerName.trim();
    const comment = input.comment.trim();
    if (
      !name ||
      name.length > 80 ||
      comment.length > 2000 ||
      !["comment", "approved", "changes_requested"].includes(input.decision) ||
      (input.decision !== "approved" && !comment)
    )
      throw new ApiError(
        400,
        "invalid_feedback",
        "Enter a name up to 80 characters and feedback up to 2,000 characters.",
      );
    const { link } = await this.active(token);
    return this.db.transaction(async (tx) => {
      // Same lock order as draft edits; approval is attached only to the exact current revision.
      const [draft] = await tx
        .select()
        .from(drafts)
        .where(eq(drafts.id, link.draftId))
        .for("update");
      const [current] = await tx.select().from(links).where(eq(links.id, link.id)).for("update");
      if (!current || current.revokedAt || current.expiresAt <= this.now()) throw missing();
      if (!draft || draft.revision !== link.revision) throw stale();
      const previous = await tx
        .select({ id: feedback.id })
        .from(feedback)
        .where(eq(feedback.linkId, link.id));
      if (previous.length >= 100)
        throw new ApiError(429, "feedback_limit", "This link has reached its feedback limit.");
      const [entry] = await tx
        .insert(feedback)
        .values({
          linkId: link.id,
          reviewerName: name,
          comment,
          decision: input.decision,
          identityVerified: false,
        })
        .returning();
      return {
        id: entry!.id,
        reviewerName: name,
        identityVerified: false as const,
        comment,
        decision: input.decision,
        createdAt: iso(entry!.createdAt),
      };
    });
  }
}
