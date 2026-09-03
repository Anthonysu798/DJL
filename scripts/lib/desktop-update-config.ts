import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

function parseTopLevelYaml(contents: string): Record<string, string> {
  const entries: Record<string, string> = {};
  for (const line of contents.split(/\r?\n/)) {
    const match = /^(\w+):\s*(.+)$/.exec(line);
    if (match?.[1] && match[2]) entries[match[1]] = match[2].trim();
  }
  return entries;
}

export function assertPackagedDesktopUpdateConfig(contents: string, expectedUrl: string): void {
  const config = parseTopLevelYaml(contents);
  if (config.provider !== "generic") {
    throw new Error(`Packaged updater provider must be generic, received ${config.provider}.`);
  }
  if (config.url !== expectedUrl) {
    throw new Error(`Packaged updater URL must be ${expectedUrl}, received ${config.url}.`);
  }
  if (config.owner || config.repo) {
    throw new Error(
      "Packaged generic updater config must not contain GitHub owner or repo fields.",
    );
  }
}

export function findPackagedDesktopUpdateConfigs(directory: string): string[] {
  const matches: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    for (const candidate of [
      join(directory, entry.name, "resources", "app-update.yml"),
      join(directory, entry.name, "DJL.app", "Contents", "Resources", "app-update.yml"),
    ]) {
      if (existsSync(candidate)) matches.push(candidate);
    }
  }
  return matches.toSorted();
}
