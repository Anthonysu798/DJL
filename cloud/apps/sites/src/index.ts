/**
 * The slcor.site server. Reads site rows and deploy manifests from Postgres,
 * file bytes from storage, forwards visitor reports to the API, and records
 * visits in batches for the idle-site expiry job.
 */
import { inArray } from "drizzle-orm";
import { blobStoreFromEnv } from "@djl/api/blobs";
import { createDatabase, schema } from "@djl/db";

import { createReportForwarder, createSiteLookup } from "./data.ts";
import { makeSiteHandler } from "./handler.ts";

const env = process.env;
const port = Number(env.SITES_PORT ?? 8790);
const domain = env.SITES_DOMAIN?.trim() || "slcor.site";
const { db } = createDatabase(env.DATABASE_URL ?? "postgres://djl:djl@localhost:54329/djl", {
  max: 8,
});
const blobs = blobStoreFromEnv(env, { mockExternals: env.DJL_MOCK_EXTERNALS === "true" });

const visited = new Set<string>();
setInterval(() => {
  if (visited.size === 0) return;
  const ids = [...visited];
  visited.clear();
  db.update(schema.sites)
    .set({ lastVisitAt: new Date() })
    .where(inArray(schema.sites.id, ids))
    .catch((error: unknown) =>
      console.error(
        JSON.stringify({ level: "error", msg: "site_visits_flush_failed", error: String(error) }),
      ),
    );
}, 60_000).unref();

const handle = makeSiteHandler({
  domain,
  lookup: createSiteLookup(db),
  read: (key, maxBytes) => blobs.read(key, maxBytes),
  report: createReportForwarder(env.API_INTERNAL_URL ?? "http://api:8787"),
  onVisit: (id) => void visited.add(id),
  ipRequestsPerMinute: Number(env.SITES_IP_REQUESTS_PER_MINUTE ?? 600),
  siteBytesPerDay: Number(env.SITES_BYTES_PER_DAY ?? 10 * 1024 ** 3),
});

const server = Bun.serve({
  port,
  hostname: "0.0.0.0",
  maxRequestBodySize: 64 * 1024,
  async fetch(request, srv) {
    try {
      if (new URL(request.url).pathname === "/__health") return new Response("ok");
      return await handle(request, srv.requestIP(request)?.address ?? null);
    } catch (error) {
      console.error(
        JSON.stringify({ level: "error", msg: "site_request_failed", error: String(error) }),
      );
      return new Response("Something went wrong.", {
        status: 500,
        headers: { "cache-control": "no-store" },
      });
    }
  },
});
console.log(JSON.stringify({ level: "info", msg: "sites_listening", port: server.port, domain }));
