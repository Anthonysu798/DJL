// FILE: ingest.ts
// Purpose: Strict validation of the two event shapes the stats worker accepts.

export const MAX_BODY_BYTES = 4096;

export type DownloadPlatform = "windows" | "mac";
export type InstallPlatform = "darwin" | "win32";
export type Arch = "x64" | "arm64";
export type DownloadSource = "github" | "oss";

export interface VisitEvent {
  readonly visitorId: string;
  readonly path: string;
  readonly country: string | null;
}

export interface DownloadEvent {
  readonly platform: DownloadPlatform;
  readonly arch: Arch;
  readonly source: DownloadSource;
  readonly country: string | null;
  readonly version: string | null;
}

export interface InstallEvent {
  readonly installId: string;
  readonly version: string;
  readonly platform: InstallPlatform;
  readonly arch: Arch;
  readonly channel: string | null;
}

const DOWNLOAD_PLATFORMS: ReadonlySet<string> = new Set(["windows", "mac"]);
const INSTALL_PLATFORMS: ReadonlySet<string> = new Set(["darwin", "win32"]);
const ARCHES: ReadonlySet<string> = new Set(["x64", "arm64"]);
const SOURCES: ReadonlySet<string> = new Set(["github", "oss"]);
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHANNEL_PATTERN = /^[0-9A-Za-z._-]{1,32}$/;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function normalizeCountry(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const country = value.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(country) ? country : null;
}

export function parseVisitEvent(value: unknown): VisitEvent | null {
  const input = record(value);
  if (!input) return null;
  const { visitorId, path } = input;
  if (typeof visitorId !== "string" || !UUID_PATTERN.test(visitorId)) return null;
  if (
    typeof path !== "string" ||
    !path.startsWith("/") ||
    path.length > 256 ||
    path.includes("?") ||
    path.includes("#") ||
    path.startsWith("//")
  ) {
    return null;
  }
  const country = normalizeCountry(input.country);
  if (input.country !== undefined && input.country !== null && country === null) return null;
  return { visitorId: visitorId.toLowerCase(), path, country };
}

function normalizeVersion(value: unknown): string | null {
  return typeof value === "string" && VERSION_PATTERN.test(value) ? value : null;
}

export function parseDownloadEvent(value: unknown): DownloadEvent | null {
  const input = record(value);
  if (!input) return null;
  const { platform, arch, source, version } = input;
  if (typeof platform !== "string" || !DOWNLOAD_PLATFORMS.has(platform)) return null;
  if (typeof arch !== "string" || !ARCHES.has(arch)) return null;
  if (typeof source !== "string" || !SOURCES.has(source)) return null;
  if (version !== undefined && version !== null && normalizeVersion(version) === null) return null;
  return {
    platform: platform as DownloadPlatform,
    arch: arch as Arch,
    source: source as DownloadSource,
    country: normalizeCountry(input.country),
    version: normalizeVersion(version),
  };
}

export function parseInstallEvent(value: unknown): InstallEvent | null {
  const input = record(value);
  if (!input) return null;
  const { installId, version, platform, arch, channel } = input;
  if (typeof installId !== "string" || !UUID_PATTERN.test(installId)) return null;
  const normalizedVersion = normalizeVersion(version);
  if (normalizedVersion === null) return null;
  if (typeof platform !== "string" || !INSTALL_PLATFORMS.has(platform)) return null;
  if (typeof arch !== "string" || !ARCHES.has(arch)) return null;
  if (channel !== undefined && channel !== null) {
    if (typeof channel !== "string" || !CHANNEL_PATTERN.test(channel)) return null;
  }
  return {
    installId: installId.toLowerCase(),
    version: normalizedVersion,
    platform: platform as InstallPlatform,
    arch: arch as Arch,
    channel: typeof channel === "string" ? channel : null,
  };
}
