import { randomBytes } from "node:crypto";
import { and, eq, inArray, desc, asc, sql } from "drizzle-orm";
import type { DjlDatabase } from "@djl/db";
import {
  socialTrackingLinks as links,
  socialTrackingDaily as daily,
} from "../../../../../packages/db/src/schema/socialTrackingLinks.ts";
import { validatedTrackingTarget } from "../../../../../packages/domain/src/social/trackingLinks.ts";
import type { CloudSocialTrackingLinkInput } from "../../../../../../packages/contracts/src/cloud/trackingLinks.ts";
import { ApiError } from "../../http/errors.ts";

type Scope = { orgId: string; userId: string };
const owned = (p: Scope) => and(eq(links.orgId, p.orgId), eq(links.userId, p.userId));
const missing = () =>
  new ApiError(404, "tracking_link_unavailable", "This tracking link is unavailable or expired.");
export const TRACKING_NOTICE =
  "Link opens may include previews and bots. These counts do not measure human visits, leads, or revenue.";

export class TrackingLinkService {
  constructor(
    private readonly db: DjlDatabase,
    private readonly now = () => new Date(),
  ) {}

  async create(p: Scope, input: CloudSocialTrackingLinkInput) {
    if (!input.disclosureAccepted)
      throw new ApiError(
        400,
        "disclosure_required",
        "Confirm that the public redirect records aggregate link-open counts, which may include previews and bots.",
      );
    const targetUrl = validatedTrackingTarget(input.url);
    if (!targetUrl)
      throw new ApiError(
        400,
        "unsafe_tracking_target",
        "Use a public HTTPS website URL without credentials, tokens, private addresses, or control characters.",
      );
    if (
      !input.campaignId.trim() ||
      input.campaignId.length > 200 ||
      !input.threadId.trim() ||
      input.threadId.length > 200 ||
      !Number.isInteger(input.contentRevision) ||
      input.contentRevision < 1 ||
      ![7, 30, 90].includes(input.expiresInDays)
    )
      throw new ApiError(
        400,
        "invalid_tracking_link",
        "Choose a saved campaign version and an expiry of 7, 30, or 90 days.",
      );
    const createdAt = this.now();
    const [link] = await this.db
      .insert(links)
      .values({
        ...p,
        slug: randomBytes(16).toString("base64url"),
        targetUrl,
        campaignId: input.campaignId,
        threadId: input.threadId,
        contentRevision: input.contentRevision,
        createdAt,
        expiresAt: new Date(createdAt.getTime() + input.expiresInDays * 86400000),
      })
      .returning({ id: links.id });
    const result = await this.get(p, link!.id);
    return { link: result, publicPath: result.publicPath };
  }

  async list(
    p: Scope,
    filter: { campaignId?: string | undefined; threadId?: string | undefined } = {},
  ) {
    if (
      (filter.campaignId !== undefined &&
        (!filter.campaignId.trim() || filter.campaignId.length > 200)) ||
      (filter.threadId !== undefined && (!filter.threadId.trim() || filter.threadId.length > 200))
    )
      throw new ApiError(400, "invalid_tracking_filter", "Choose a valid campaign or chat.");
    const rows = await this.db
      .select()
      .from(links)
      .where(
        and(
          owned(p),
          filter.campaignId === undefined ? undefined : eq(links.campaignId, filter.campaignId),
          filter.threadId === undefined ? undefined : eq(links.threadId, filter.threadId),
        ),
      )
      .orderBy(desc(links.createdAt));
    return this.summaries(p, rows);
  }

  async get(p: Scope, id: string) {
    const [row] = await this.db
      .select()
      .from(links)
      .where(and(eq(links.id, id), owned(p)));
    if (!row) throw missing();
    return (await this.summaries(p, [row]))[0]!;
  }

  async revoke(p: Scope, id: string) {
    const [row] = await this.db
      .update(links)
      .set({ revokedAt: this.now() })
      .where(and(eq(links.id, id), owned(p)))
      .returning({ id: links.id });
    if (!row) throw missing();
    return { id: row.id, revoked: true };
  }

  /** Only the HTTP redirect route calls this. The destination cannot be edited or overridden. */
  async open(slug: string, count: boolean) {
    if (!/^[A-Za-z0-9_-]{22}$/.test(slug)) throw missing();
    return this.db.transaction(async (tx) => {
      const [link] = await tx.select().from(links).where(eq(links.slug, slug)).for("update");
      const now = this.now();
      if (!link || link.revokedAt || link.expiresAt <= now) throw missing();
      // Fail closed if a legacy/manual row ever bypassed create-time validation.
      if (validatedTrackingTarget(link.targetUrl) !== link.targetUrl) throw missing();
      if (count)
        await tx
          .insert(daily)
          .values({
            linkId: link.id,
            orgId: link.orgId,
            userId: link.userId,
            day: now.toISOString().slice(0, 10),
            linkOpens: 1,
          })
          .onConflictDoUpdate({
            target: [daily.linkId, daily.day],
            set: { linkOpens: sql`${daily.linkOpens} + 1` },
          });
      return link.targetUrl;
    });
  }

  private async summaries(p: Scope, rows: (typeof links.$inferSelect)[]) {
    if (!rows.length) return [];
    const counts = await this.db
      .select()
      .from(daily)
      .where(
        and(
          inArray(
            daily.linkId,
            rows.map((row) => row.id),
          ),
          eq(daily.orgId, p.orgId),
          eq(daily.userId, p.userId),
        ),
      )
      .orderBy(asc(daily.day));
    return rows.map((row) => {
      const days = counts
        .filter((entry) => entry.linkId === row.id)
        .map((entry) => ({ day: entry.day, linkOpens: entry.linkOpens }));
      return {
        id: row.id,
        publicPath: `/l/${row.slug}`,
        targetUrl: row.targetUrl,
        campaignId: row.campaignId,
        threadId: row.threadId,
        contentRevision: row.contentRevision,
        createdAt: row.createdAt.toISOString(),
        expiresAt: row.expiresAt.toISOString(),
        revokedAt: row.revokedAt?.toISOString() ?? null,
        linkOpens: days.reduce((sum, day) => sum + day.linkOpens, 0),
        daily: days,
        measurement: "link_opens" as const,
        notice: TRACKING_NOTICE,
      };
    });
  }
}
