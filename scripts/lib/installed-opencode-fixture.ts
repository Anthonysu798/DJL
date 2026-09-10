import { cp, mkdir } from "node:fs/promises";
import { join } from "node:path";

/** Seed real, preinstalled dependencies without sharing config or credentials between fixtures. */
export async function prepareInstalledOpenCodeFixture(
  configHome: string,
  dependencyRoot = process.env.DJL_TEST_OPENCODE_DEPENDENCIES,
): Promise<void> {
  if (!dependencyRoot) return;
  const configDirectory = join(configHome, "opencode");
  await mkdir(configDirectory, { recursive: true });
  // OpenCode checks both node_modules and the npm lock before deciding to install.
  // Copy actual packages rather than fabricating a lock to bypass that check.
  for (const name of ["package.json", "package-lock.json", "node_modules"]) {
    await cp(join(dependencyRoot, name), join(configDirectory, name), { recursive: true });
  }
}
