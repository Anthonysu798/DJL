// FILE: index.ts
// Purpose: Cloudflare Worker that counts DJL download clicks and unique desktop installs in D1.

import { MAX_BODY_BYTES, normalizeCountry, parseDownloadEvent, parseInstallEvent } from "./ingest";
import { buildSummary, summaryWindowStart, type CountRow, type DayRow } from "./summary";

export interface Env {
  readonly DB: D1Database;
  readonly STATS_READ_TOKEN?: string;
}

type RequestWithCf = Request & { readonly cf?: { readonly country?: unknown } };

const securityHeaders = {
  "cache-control": "no-store",
  "content-security-policy": "default-src 'none'",
  "x-content-type-options": "nosniff",
} as const;

const jsonResponse = (value: unknown, status = 200): Response =>
  Response.json(value, { status, headers: securityHeaders });

const errorResponse = (status: number, code: string): Response =>
  jsonResponse({ error: code }, status);

const emptyResponse = (): Response => new Response(null, { status: 204, headers: securityHeaders });

type BodyRead = { readonly ok: true; readonly value: unknown } | { readonly ok: false };

async function readJsonBody(request: Request): Promise<BodyRead> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return { ok: false };
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) return { ok: false };
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

function constantTimeEquals(left: string, right: string): boolean {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  if (a.byteLength !== b.byteLength) return false;
  let diff = 0;
  for (let index = 0; index < a.byteLength; index += 1) {
    diff |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return diff === 0;
}

function isAuthorized(request: Request, token: string | undefined): boolean {
  if (!token) return false;
  const header = request.headers.get("authorization") ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
  return presented.length > 0 && constantTimeEquals(presented, token);
}

async function recordDownload(request: Request, env: Env, now: Date): Promise<Response> {
  const body = await readJsonBody(request);
  if (!body.ok) return errorResponse(400, "invalid_body");
  const event = parseDownloadEvent(body.value);
  if (!event) return errorResponse(400, "invalid_event");
  await env.DB.prepare(
    "INSERT INTO downloads (ts, platform, arch, source, country, version) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
  )
    .bind(now.toISOString(), event.platform, event.arch, event.source, event.country, event.version)
    .run();
  return emptyResponse();
}

async function recordInstall(request: RequestWithCf, env: Env, now: Date): Promise<Response> {
  const body = await readJsonBody(request);
  if (!body.ok) return errorResponse(400, "invalid_body");
  const event = parseInstallEvent(body.value);
  if (!event) return errorResponse(400, "invalid_event");
  // The ping comes straight from the user's machine, so Cloudflare's country is the user's.
  const country = normalizeCountry(request.cf?.country);
  await env.DB.prepare(
    "INSERT OR IGNORE INTO installs (install_id, first_seen, version, platform, arch, channel, country) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
  )
    .bind(
      event.installId,
      now.toISOString(),
      event.version,
      event.platform,
      event.arch,
      event.channel,
      country,
    )
    .run();
  return emptyResponse();
}

function rows<T>(result: D1Result<unknown> | undefined): readonly T[] {
  return (result?.results ?? []) as readonly T[];
}

function total(result: D1Result<unknown> | undefined): number {
  return rows<{ count: number }>(result)[0]?.count ?? 0;
}

async function readSummary(env: Env, now: Date): Promise<Response> {
  const since = summaryWindowStart(now);
  const db = env.DB;
  const [
    installsTotal,
    installsByCountry,
    installsByPlatform,
    installsByVersion,
    installsByDay,
    downloadsTotal,
    downloadsBySource,
    downloadsByCountry,
    downloadsByPlatform,
    downloadsByDay,
  ] = await db.batch([
    db.prepare("SELECT count(*) AS count FROM installs"),
    db.prepare("SELECT country AS key, count(*) AS count FROM installs GROUP BY country"),
    db.prepare("SELECT platform AS key, count(*) AS count FROM installs GROUP BY platform"),
    db.prepare("SELECT version AS key, count(*) AS count FROM installs GROUP BY version"),
    db
      .prepare(
        "SELECT substr(first_seen, 1, 10) AS day, count(*) AS count FROM installs WHERE first_seen >= ?1 GROUP BY day",
      )
      .bind(since),
    db.prepare("SELECT count(*) AS count FROM downloads"),
    db.prepare("SELECT source AS key, count(*) AS count FROM downloads GROUP BY source"),
    db.prepare("SELECT country AS key, count(*) AS count FROM downloads GROUP BY country"),
    db.prepare("SELECT platform AS key, count(*) AS count FROM downloads GROUP BY platform"),
    db
      .prepare(
        "SELECT substr(ts, 1, 10) AS day, count(*) AS count FROM downloads WHERE ts >= ?1 GROUP BY day",
      )
      .bind(since),
  ]);
  return jsonResponse(
    buildSummary(
      {
        installsTotal: total(installsTotal),
        installsByCountry: rows<CountRow>(installsByCountry),
        installsByPlatform: rows<CountRow>(installsByPlatform),
        installsByVersion: rows<CountRow>(installsByVersion),
        installsByDay: rows<DayRow>(installsByDay),
        downloadsTotal: total(downloadsTotal),
        downloadsBySource: rows<CountRow>(downloadsBySource),
        downloadsByCountry: rows<CountRow>(downloadsByCountry),
        downloadsByPlatform: rows<CountRow>(downloadsByPlatform),
        downloadsByDay: rows<DayRow>(downloadsByDay),
      },
      now,
    ),
  );
}

export async function handleRequest(
  request: Request,
  env: Env,
  now = new Date(),
): Promise<Response> {
  const { pathname } = new URL(request.url);
  switch (pathname) {
    case "/v1/downloads":
      if (request.method !== "POST") return errorResponse(405, "method_not_allowed");
      return recordDownload(request, env, now);
    case "/v1/installs":
      if (request.method !== "POST") return errorResponse(405, "method_not_allowed");
      return recordInstall(request as RequestWithCf, env, now);
    case "/v1/stats":
      if (request.method !== "GET") return errorResponse(405, "method_not_allowed");
      if (!isAuthorized(request, env.STATS_READ_TOKEN)) return errorResponse(401, "unauthorized");
      return readSummary(env, now);
    default:
      return errorResponse(404, "not_found");
  }
}

export default {
  fetch: (request, env) => handleRequest(request, env),
} satisfies ExportedHandler<Env>;
