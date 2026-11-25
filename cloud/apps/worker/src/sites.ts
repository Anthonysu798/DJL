/**
 * Idle slcor.site sites. After 90 days with no visits and no publishes the
 * owner is emailed; 14 days after that, if still nobody has visited or
 * published, the site is unpublished and its name freed. Sites taken down by
 * DJL are left for moderators.
 */
import { and, eq, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { schema, type DjlDatabase } from "@djl/db";
import type { BlobStore } from "@djl/api/blobs";
import { deleteSiteAndFiles } from "@djl/api/sites";
import { siteIdle, type EmailSender } from "@djl/notify";

export const SITE_IDLE_DAYS = 90;
export const SITE_GRACE_DAYS = 14;
const DAY = 86_400_000;

export interface SiteExpiryDeps {
  readonly db: DjlDatabase;
  readonly blobs: BlobStore;
  readonly email: EmailSender;
  readonly sitesDomain: string;
  readonly now?: () => Date;
}

/** Latest of visit, publish and creation: the last sign that someone cares about the site. */
const lastActivity = sql`GREATEST(
  COALESCE(${schema.sites.lastVisitAt}, ${schema.sites.createdAt}),
  COALESCE(${schema.sites.lastDeployAt}, ${schema.sites.createdAt}),
  ${schema.sites.createdAt}
)`;

export async function expireIdleSites(
  deps: SiteExpiryDeps,
): Promise<{ warned: number; unpublished: number }> {
  const now = deps.now?.() ?? new Date();
  const idleSince = new Date(now.getTime() - SITE_IDLE_DAYS * DAY);
  const graceEnded = new Date(now.getTime() - SITE_GRACE_DAYS * DAY);

  const toWarn = await deps.db
    .select({ site: schema.sites, email: schema.user.email, locale: schema.user.locale })
    .from(schema.sites)
    .innerJoin(schema.user, eq(schema.user.id, schema.sites.userId))
    .where(
      and(
        eq(schema.sites.status, "active"),
        isNull(schema.sites.expiryWarnedAt),
        sql`${lastActivity} < ${idleSince.toISOString()}::timestamptz`,
      ),
    )
    .limit(500);
  let warned = 0;
  for (const { site, email, locale } of toWarn) {
    // Mark first so a crash after sending cannot send twice; a failed send is not retried.
    const [marked] = await deps.db
      .update(schema.sites)
      .set({ expiryWarnedAt: now })
      .where(and(eq(schema.sites.id, site.id), isNull(schema.sites.expiryWarnedAt)))
      .returning({ id: schema.sites.id });
    if (!marked) continue;
    await deps.email
      .send(
        siteIdle(
          email,
          `https://${site.name}.${deps.sitesDomain}`,
          locale === "zh-Hans" ? "zh-Hans" : "en",
        ),
      )
      .catch(() =>
        console.error(
          JSON.stringify({
            level: "error",
            job: "sites.expire-idle",
            code: "site_idle_email_failed",
          }),
        ),
      );
    warned += 1;
  }

  const toUnpublish = await deps.db
    .select()
    .from(schema.sites)
    .where(
      and(
        eq(schema.sites.status, "active"),
        isNotNull(schema.sites.expiryWarnedAt),
        lt(schema.sites.expiryWarnedAt, graceEnded),
        // A visit or publish after the warning keeps the site (a publish also clears the warning).
        sql`${lastActivity} < ${schema.sites.expiryWarnedAt}`,
      ),
    )
    .limit(500);
  for (const site of toUnpublish) await deleteSiteAndFiles(deps.db, deps.blobs, site);
  return { warned, unpublished: toUnpublish.length };
}
