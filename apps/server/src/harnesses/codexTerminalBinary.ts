import { access, readFile, realpath } from "node:fs/promises";
import { constants } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { compareCodexCliVersions, parseCodexCliVersion } from "../provider/codexCliVersion";
import { probe, type AccountProbe } from "./accounts";

// Resolve on launch, rather than pinning the first PATH hit for the server's lifetime.
export async function resolveCodexTerminalBinary(
  configured: string,
  env: NodeJS.ProcessEnv,
  runProbe: AccountProbe = probe,
): Promise<string> {
  if (configured !== "codex") return configured;
  const home = env.HOME ?? env.USERPROFILE;
  const bins = (env.PATH ?? env.Path ?? "").split(delimiter).filter(Boolean);
  if (env.BUN_INSTALL) bins.push(join(env.BUN_INSTALL, "bin"));
  if (home) bins.push(join(home, ".bun", "bin"), join(home, ".npm-global", "bin"));
  if (env.APPDATA) bins.push(join(env.APPDATA, "npm"));
  const names = process.platform === "win32" ? ["codex.exe", "codex.cmd", "codex"] : ["codex"];
  const seen = new Set<string>();
  const candidates: string[] = [];
  for (const bin of new Set(bins)) {
    if (bin.includes("_managed-bin") || bin.includes("terminal-accounts")) continue;
    for (const name of names) {
      const candidate = join(bin, name);
      try {
        await access(candidate, constants.X_OK);
        const target = await realpath(candidate);
        if (!seen.has(target)) {
          seen.add(target);
          candidates.push(candidate);
        }
      } catch {
        /* An absent installation is not a candidate. */
      }
    }
  }
  const versions = await Promise.all(
    candidates.map(async (binary) => {
      // Package metadata avoids starting multiple native CLIs during a batch launch.
      try {
        const target = await realpath(binary);
        const pkg = JSON.parse(await readFile(join(dirname(target), "..", "package.json"), "utf8"));
        if (pkg.name === "@openai/codex" && typeof pkg.version === "string")
          return { binary, version: parseCodexCliVersion(pkg.version) };
      } catch {
        /* Native installations expose their version through --version. */
      }
      const result = await runProbe(binary, ["--version"], env);
      return { binary, version: result.code === 0 ? parseCodexCliVersion(result.stdout) : null };
    }),
  );
  let selected = versions[0];
  for (const candidate of versions) {
    if (
      candidate.version &&
      (!selected?.version || compareCodexCliVersions(candidate.version, selected.version) > 0)
    )
      selected = candidate;
  }
  return selected?.binary ?? configured;
}
