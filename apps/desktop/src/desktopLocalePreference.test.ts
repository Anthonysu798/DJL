import * as FS from "node:fs";
import * as OS from "node:os";
import * as Path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  readDesktopLocalePreference,
  resolveDesktopLocalePreferencePath,
  writeDesktopLocalePreference,
} from "./desktopLocalePreference";

const tempDirs: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of tempDirs.splice(0)) FS.rmSync(dir, { recursive: true, force: true });
});

function makeUserDataDir(): string {
  const dir = FS.mkdtempSync(Path.join(OS.tmpdir(), "djl-locale-test-"));
  tempDirs.push(dir);
  return dir;
}

describe("desktop locale preference cache", () => {
  it("defaults missing, malformed, and invalid cache contents to system", () => {
    const userData = makeUserDataDir();
    const cachePath = resolveDesktopLocalePreferencePath(userData);
    expect(readDesktopLocalePreference(cachePath)).toBe("system");

    FS.writeFileSync(cachePath, "not-json");
    expect(readDesktopLocalePreference(cachePath)).toBe("system");

    FS.writeFileSync(cachePath, JSON.stringify({ version: 1, preference: "de-DE" }));
    expect(readDesktopLocalePreference(cachePath)).toBe("system");

    FS.writeFileSync(cachePath, JSON.stringify({ version: 2, preference: "ja" }));
    expect(readDesktopLocalePreference(cachePath)).toBe("system");
  });

  it("atomically persists a validated preference with owner-only permissions", () => {
    const userData = makeUserDataDir();
    const cachePath = resolveDesktopLocalePreferencePath(userData);
    writeDesktopLocalePreference(cachePath, "zh-Hant");

    expect(readDesktopLocalePreference(cachePath)).toBe("zh-Hant");
    expect(JSON.parse(FS.readFileSync(cachePath, "utf8"))).toEqual({
      version: 1,
      preference: "zh-Hant",
    });
    expect(FS.statSync(cachePath).mode & 0o777).toBe(0o600);
    expect(FS.readdirSync(userData)).toEqual([Path.basename(cachePath)]);
  });

  it("writes successfully on Windows without trying to fsync the directory", () => {
    const userData = makeUserDataDir();
    const cachePath = resolveDesktopLocalePreferencePath(userData);
    const openSync = vi.fn((path: FS.PathLike, flags: FS.OpenMode, mode?: FS.Mode | null) => {
      if (Path.resolve(String(path)) === Path.resolve(userData)) {
        throw new Error("Windows cannot open a directory for fsync");
      }
      return FS.openSync(path, flags, mode ?? undefined);
    });

    expect(() =>
      writeDesktopLocalePreference(cachePath, "fr", {
        platform: "win32",
        fileSystem: { ...FS, openSync },
      }),
    ).not.toThrow();
    expect(openSync).toHaveBeenCalled();
    expect(openSync.mock.calls.some(([path]) => Path.resolve(String(path)) === userData)).toBe(
      false,
    );
    expect(readDesktopLocalePreference(cachePath)).toBe("fr");
  });

  it("does not report failure after rename when directory durability is unsupported", () => {
    const userData = makeUserDataDir();
    const cachePath = resolveDesktopLocalePreferencePath(userData);
    const openSync = vi.fn((path: FS.PathLike, flags: FS.OpenMode, mode?: FS.Mode | null) => {
      if (Path.resolve(String(path)) === Path.resolve(userData)) {
        throw new Error("directory fsync unsupported");
      }
      return FS.openSync(path, flags, mode ?? undefined);
    });

    expect(() =>
      writeDesktopLocalePreference(cachePath, "ko", {
        platform: "linux",
        fileSystem: { ...FS, openSync },
      }),
    ).not.toThrow();
    expect(openSync.mock.calls.some(([path]) => Path.resolve(String(path)) === userData)).toBe(
      true,
    );
    expect(readDesktopLocalePreference(cachePath)).toBe("ko");
  });
});
