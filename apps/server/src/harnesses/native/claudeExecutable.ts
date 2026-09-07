import { constants } from "node:fs";
import { access, realpath, stat } from "node:fs/promises";
import { posix, win32 } from "node:path";

export function claudeExecutableCandidates(
  command: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
): string[] {
  const path = platform === "win32" ? win32 : posix;
  const home = env.HOME ?? env.USERPROFILE;
  if (command.startsWith("~/") && home) command = path.join(home, command.slice(2));
  // An explicit override must never silently select a different installation.
  if (/[\\/]/.test(command)) return [path.resolve(command)];
  const pathKey = Object.keys(env).find((key) => key.toUpperCase() === "PATH");
  const directories = (pathKey ? (env[pathKey] ?? "") : "").split(path.delimiter).filter(Boolean);
  if (command === "claude" && home) directories.push(path.join(home, ".local", "bin"));
  // The SDK launches a native binary directly; .cmd/.bat shims require a shell.
  const name = platform === "win32" && !path.extname(command) ? `${command}.exe` : command;
  return [...new Set(directories)].map((directory) => path.resolve(directory, name));
}

export async function resolveClaudeExecutable(
  command = "claude",
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  for (const candidate of claudeExecutableCandidates(command, env)) {
    try {
      await access(candidate, process.platform === "win32" ? constants.F_OK : constants.X_OK);
      if (!(await stat(candidate)).isFile()) continue;
      return await realpath(candidate);
    } catch {
      // Try the next PATH entry or the standard native installation.
    }
  }
  throw new Error(
    `Claude Code executable not found or not executable at ${command}. Open Settings > Accounts to install Claude Code or set its executable path.`,
  );
}
