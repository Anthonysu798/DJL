// FILE: installPing.ts
// Purpose: One-time anonymous install ping. Pure helpers plus an orchestration written against
// injected file and network dependencies so it runs under Vitest without Electron.
// Layer: Desktop startup utility

import * as Crypto from "node:crypto";
import * as Path from "node:path";

const INSTALL_RECORD_FILENAME = "install-record.json";
const INSTALL_PING_TIMEOUT_MS = 5_000;

export interface InstallRecord {
  readonly schemaVersion: 1;
  readonly installId: string;
  readonly createdAt: string;
  readonly reportedAt: string | null;
}

export interface InstallPingRuntime {
  readonly version: string;
  readonly platform: NodeJS.Platform;
  readonly arch: string;
  readonly channel: string;
}

export interface InstallPingPayload {
  readonly installId: string;
  readonly version: string;
  readonly platform: NodeJS.Platform;
  readonly arch: string;
  readonly channel: string;
}

export interface InstallPingPackageMetadata {
  readonly djlStatsUrl?: unknown;
}

export interface InstallPingDependencies {
  readonly recordPath: string;
  readonly statsUrl: string;
  readonly runtime: InstallPingRuntime;
  readonly readFile: (path: string) => string | null;
  readonly writeFile: (path: string, contents: string) => void;
  readonly fetch: typeof fetch;
  readonly now: () => Date;
  readonly warn: (message: string) => void;
}

export type InstallPingOutcome = "reported" | "already-reported" | "deferred";

export function resolveInstallRecordPath(userDataPath: string): string {
  return Path.join(userDataPath, INSTALL_RECORD_FILENAME);
}

export function parseInstallRecord(raw: string | null): InstallRecord | null {
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const { schemaVersion, installId, createdAt, reportedAt } = parsed as Record<string, unknown>;
    if (schemaVersion !== 1) return null;
    if (typeof installId !== "string" || !/^[0-9a-f-]{36}$/i.test(installId)) return null;
    if (typeof createdAt !== "string") return null;
    if (reportedAt !== null && typeof reportedAt !== "string") return null;
    return { schemaVersion: 1, installId, createdAt, reportedAt };
  } catch {
    return null;
  }
}

export function createInstallRecord(now: Date): InstallRecord {
  return {
    schemaVersion: 1,
    installId: Crypto.randomUUID(),
    createdAt: now.toISOString(),
    reportedAt: null,
  };
}

export function serializeInstallRecord(record: InstallRecord): string {
  return `${JSON.stringify(record, null, 2)}\n`;
}

export function buildInstallPingPayload(
  record: InstallRecord,
  runtime: InstallPingRuntime,
): InstallPingPayload {
  return {
    installId: record.installId,
    version: runtime.version,
    platform: runtime.platform,
    arch: runtime.arch,
    channel: runtime.channel,
  };
}

export function normalizeStatsUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:") return null;
    if (url.username || url.password || url.search || url.hash) return null;
    return url.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

export function resolveStatsUrl(
  env: NodeJS.ProcessEnv,
  packageMetadata: InstallPingPackageMetadata | null = null,
): string | null {
  return normalizeStatsUrl(env.DJL_STATS_URL) ?? normalizeStatsUrl(packageMetadata?.djlStatsUrl);
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Reads or creates the install record and reports it once. Every failure leaves the record
// unreported so the next launch retries; nothing here may throw into startup.
export async function reportInstallOnce(
  deps: InstallPingDependencies,
): Promise<InstallPingOutcome> {
  let record = parseInstallRecord(deps.readFile(deps.recordPath));
  if (record === null) {
    record = createInstallRecord(deps.now());
    try {
      deps.writeFile(deps.recordPath, serializeInstallRecord(record));
    } catch (error) {
      // Without a persisted id a report could never be de-duplicated, so do not send one.
      deps.warn(`Could not persist install record: ${formatError(error)}`);
      return "deferred";
    }
  }
  if (record.reportedAt !== null) return "already-reported";

  try {
    const response = await deps.fetch(`${deps.statsUrl}/v1/installs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildInstallPingPayload(record, deps.runtime)),
      signal: AbortSignal.timeout(INSTALL_PING_TIMEOUT_MS),
    });
    if (!response.ok) {
      deps.warn(`Install ping rejected with status ${response.status}; will retry next launch.`);
      return "deferred";
    }
  } catch (error) {
    deps.warn(`Install ping failed: ${formatError(error)}; will retry next launch.`);
    return "deferred";
  }

  try {
    deps.writeFile(
      deps.recordPath,
      serializeInstallRecord({ ...record, reportedAt: deps.now().toISOString() }),
    );
  } catch (error) {
    // The worker de-duplicates on installId, so a retry after this is harmless.
    deps.warn(`Install ping sent but the record could not be updated: ${formatError(error)}`);
  }
  return "reported";
}
