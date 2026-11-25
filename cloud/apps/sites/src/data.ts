/**
 * The sites server's two outside dependencies: site rows and live manifests from Postgres,
 * and visitor reports forwarded to the API (which rate-limits and stores them).
 */
import { and, eq } from "drizzle-orm";
import { schema, type DjlDatabase } from "@djl/db";

import type { LiveSite, SiteHandlerDeps } from "./handler.ts";

export function createSiteLookup(db: DjlDatabase) {
  return async function lookup(name: string): Promise<LiveSite | null> {
    const site = await db.query.sites.findFirst({
      columns: { id: true, status: true, liveDeployId: true },
      where: eq(schema.sites.name, name),
    });
    if (!site) return null;
    const deploy = site.liveDeployId
      ? await db.query.siteDeploys.findFirst({
          columns: { manifest: true },
          where: and(
            eq(schema.siteDeploys.id, site.liveDeployId),
            eq(schema.siteDeploys.status, "live"),
          ),
        })
      : undefined;
    return {
      id: site.id,
      status: site.status,
      deployId: deploy ? site.liveDeployId : null,
      files: new Map(
        (deploy?.manifest ?? []).map((f) => [f.path, { size: f.size, sha256: f.sha256 }]),
      ),
    };
  };
}

/** Forward a report to the API with the visitor's IP, so its per-IP limits apply. */
export function createReportForwarder(apiUrl: string): SiteHandlerDeps["report"] {
  const base = apiUrl.replace(/\/$/, "");
  return async ({ name, reason, note, ip }) => {
    try {
      const response = await fetch(`${base}/v1/public/sites/reports`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(ip ? { "x-forwarded-for": ip } : {}),
        },
        body: JSON.stringify({ name, reason, ...(note.trim() ? { note: note.trim() } : {}) }),
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
      });
      if (response.status === 429) return "limited";
      return response.ok ? "ok" : "failed";
    } catch {
      return "failed";
    }
  };
}
