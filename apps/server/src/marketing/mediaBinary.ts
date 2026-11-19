import { accessSync, constants } from "node:fs";
import path from "node:path";

/** Only app-owned locations precede PATH; never search the conversation's working directory. */
export function resolveMediaBinary(
  name: "ffmpeg" | "ffprobe",
  options: {
    env?: NodeJS.ProcessEnv;
    executable?: string;
    platform?: NodeJS.Platform;
    arch?: string;
  } = {},
) {
  const env = options.env ?? process.env;
  const configured = env[name === "ffmpeg" ? "DJL_FFMPEG_PATH" : "DJL_FFPROBE_PATH"]?.trim();
  if (configured) return configured;
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const executable = options.executable ?? process.execPath;
  const filename = `${name}${platform === "win32" ? ".exe" : ""}`;
  // macOS Electron lives in Contents/MacOS; Windows and Linux use resources alongside it.
  const resources =
    platform === "darwin"
      ? path.resolve(path.dirname(executable), "..", "Resources")
      : path.join(path.dirname(executable), "resources");
  for (const root of [
    path.join(resources, "media", `${platform}-${arch}`),
    path.join(resources, "media"),
    path.join(
      resources,
      "app.asar.unpacked",
      "apps",
      "desktop",
      "prod-resources",
      "media",
      `${platform}-${arch}`,
    ),
  ]) {
    const candidate = path.join(root, filename);
    try {
      accessSync(candidate, platform === "win32" ? constants.F_OK : constants.X_OK);
      return candidate;
    } catch {
      /* Try the next app-owned location, then the inherited system PATH. */
    }
  }
  return name;
}
