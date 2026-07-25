import * as Crypto from "node:crypto";
import * as FS from "node:fs";
import * as Path from "node:path";
import type { AppLocalePreference } from "@synara/contracts";
import { normalizeAppLocalePreference } from "@synara/shared/locale";

const CACHE_FILE_NAME = "djl-locale-preference-v1.json";

export function resolveDesktopLocalePreferencePath(userDataPath: string): string {
  return Path.join(userDataPath, CACHE_FILE_NAME);
}

export function readDesktopLocalePreference(cachePath: string): AppLocalePreference {
  try {
    const value: unknown = JSON.parse(FS.readFileSync(cachePath, "utf8"));
    if (typeof value !== "object" || value === null) return "system";
    const record = value as { version?: unknown; preference?: unknown };
    if (record.version !== 1) return "system";
    const preference = normalizeAppLocalePreference(record.preference);
    return preference === record.preference ? preference : "system";
  } catch {
    return "system";
  }
}

export function writeDesktopLocalePreference(
  cachePath: string,
  preference: AppLocalePreference,
  options: {
    readonly platform?: NodeJS.Platform;
    readonly fileSystem?: Pick<
      typeof FS,
      | "chmodSync"
      | "closeSync"
      | "fsyncSync"
      | "mkdirSync"
      | "openSync"
      | "renameSync"
      | "unlinkSync"
      | "writeFileSync"
    >;
  } = {},
): void {
  const fileSystem = options.fileSystem ?? FS;
  const platform = options.platform ?? process.platform;
  const normalized = normalizeAppLocalePreference(preference);
  if (normalized !== preference) throw new TypeError("Invalid locale preference.");
  const directory = Path.dirname(cachePath);
  fileSystem.mkdirSync(directory, { recursive: true });
  const temporaryPath = `${cachePath}.tmp-${process.pid}-${Crypto.randomBytes(6).toString("hex")}`;
  let descriptor: number | null = null;
  try {
    descriptor = fileSystem.openSync(temporaryPath, "wx", 0o600);
    fileSystem.writeFileSync(
      descriptor,
      `${JSON.stringify({ version: 1, preference: normalized })}\n`,
      "utf8",
    );
    fileSystem.fsyncSync(descriptor);
    fileSystem.closeSync(descriptor);
    descriptor = null;
    fileSystem.renameSync(temporaryPath, cachePath);

    // Everything after rename is best-effort: the new preference is already committed,
    // so a platform-specific durability/permission limitation must not report a false failure.
    try {
      fileSystem.chmodSync(cachePath, 0o600);
    } catch {
      // Windows and some mounted filesystems do not implement POSIX permission modes.
    }
    if (platform !== "win32") {
      try {
        const directoryDescriptor = fileSystem.openSync(directory, "r");
        try {
          fileSystem.fsyncSync(directoryDescriptor);
        } finally {
          fileSystem.closeSync(directoryDescriptor);
        }
      } catch {
        // Some filesystems cannot fsync directories even though the atomic rename succeeded.
      }
    }
  } finally {
    if (descriptor !== null) fileSystem.closeSync(descriptor);
    try {
      fileSystem.unlinkSync(temporaryPath);
    } catch {
      // The rename normally consumes the temporary file; cleanup only handles failed writes.
    }
  }
}
