import { readFile, access } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it, vi } from "vitest";
import { officialInstallerUrl, runOfficialInstaller } from "./officialInstaller";
import { maintainKimiNativeTool } from "./kimiTools";
import { isNativeKimiPath } from "./kimiExecutable";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it("uses the vendor's documented platform-specific installers", () => {
  expect(officialInstallerUrl("cursor", "win32")).toBe("https://cursor.com/install?win32=true");
  expect(officialInstallerUrl("kimi", "win32")).toBe("https://code.kimi.com/kimi-code/install.ps1");
  expect(officialInstallerUrl("kimi", "darwin")).toBe("https://code.kimi.com/kimi-code/install.sh");
});

it("keeps Kimi's native update in its original install root and removes the scratch installer", async () => {
  const root = join(tmpdir(), "djl-kimi-native-test");
  vi.stubEnv("KIMI_INSTALL_DIR", root);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("# official installer fixture")),
  );
  let script = "";
  await maintainKimiNativeTool(
    {
      id: "kimi",
      installed: true,
      currentVersion: "0.40.0",
      latestVersion: "0.41.0",
      status: "behind_latest",
      canUpdate: true,
      canInstall: false,
    },
    async (_command, args, env) => {
      script = args.at(-1)!;
      expect(await readFile(script, "utf8")).toBe("# official installer fixture");
      expect(env).toMatchObject({
        KIMI_INSTALL_DIR: root,
        KIMI_VERSION: "0.41.0",
        KIMI_NO_MODIFY_PATH: "1",
      });
      expect(
        isNativeKimiPath(join(root, "bin", process.platform === "win32" ? "kimi.exe" : "kimi")),
      ).toBe(true);
      expect(isNativeKimiPath(join(root, "bin-other", "kimi"))).toBe(false);
    },
  );
  await expect(access(script)).rejects.toThrow();
});

it("cleans the downloaded installer after the runner fails", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("# fixture")),
  );
  let script = "";
  await expect(
    runOfficialInstaller("cursor", async (_command, args) => {
      script = args.at(-1)!;
      throw new Error("Failed");
    }),
  ).rejects.toThrow("Failed");
  await expect(access(script)).rejects.toThrow();
});
