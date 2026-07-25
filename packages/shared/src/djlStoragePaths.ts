// FILE: djlStoragePaths.ts
// Purpose: Canonical DJL filesystem layout and legacy home-variable compatibility.

import path from "node:path";

export const DJL_HOME_ENV = "DJL_HOME";
export const LEGACY_DJL_HOME_ENV = "SYNARA_HOME";
export const DJL_HOME_DIR_NAME = ".djl";
export const LEGACY_DJL_HOME_DIR_NAME = ".synara";

function pathApiFor(...values: ReadonlyArray<string | undefined>): typeof path.posix {
  return values.some((value) => value !== undefined && /^(?:[a-z]:[\\/]|\\\\)/i.test(value))
    ? path.win32
    : path.posix;
}

export function resolveDjlHome(env: NodeJS.ProcessEnv, homeDir: string): string {
  const configured = env[DJL_HOME_ENV]?.trim() || env[LEGACY_DJL_HOME_ENV]?.trim();
  const pathApi = pathApiFor(configured, homeDir);
  return pathApi.resolve(configured || pathApi.join(homeDir, DJL_HOME_DIR_NAME));
}

export function resolveDesktopDjlHome(
  env: NodeJS.ProcessEnv,
  homeDir: string,
  localAppData: string | undefined,
  platform: NodeJS.Platform = process.platform,
): string {
  if (env[DJL_HOME_ENV]?.trim() || env[LEGACY_DJL_HOME_ENV]?.trim()) {
    return resolveDjlHome(env, homeDir);
  }
  if (platform === "win32" && localAppData?.trim()) {
    return path.win32.resolve(localAppData.trim(), "DJL", "Data");
  }
  return resolveDjlHome(env, homeDir);
}

export function resolveDjlStatePaths(
  baseDir: string,
  development: boolean,
  shareCompleteState = false,
): {
  readonly stateDir: string;
  readonly managedOpenCodeRootDir: string;
} {
  const pathApi = pathApiFor(baseDir);
  return {
    stateDir: pathApi.join(baseDir, development && !shareCompleteState ? "dev" : "userdata"),
    managedOpenCodeRootDir: pathApi.join(baseDir, "userdata", "opencode"),
  };
}
