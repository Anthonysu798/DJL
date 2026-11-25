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

function unquoteYamlScalar(value: string): string {
  return value.trim().replace(/^(['"])(.*)\1$/, "$2");
}

/** Reads the signer names electron-updater checks a Windows update's Authenticode subject against. */
export function readPackagedUpdatePublisherNames(contents: string): string[] {
  const lines = contents.split(/\r?\n/);
  const index = lines.findIndex((line) => line.startsWith("publisherName:"));
  if (index < 0) return [];
  const inline = lines[index]!.slice("publisherName:".length).trim();
  if (inline) return [unquoteYamlScalar(inline)];
  const names: string[] = [];
  for (const line of lines.slice(index + 1)) {
    const item = /^\s*-\s+(.+)$/.exec(line);
    if (!item?.[1]) break;
    names.push(unquoteYamlScalar(item[1]));
  }
  return names;
}

/**
 * electron-updater skips Authenticode verification entirely when app-update.yml carries no
 * publisherName, so a signed Windows build must ship exactly the publisher it was signed for.
 */
export function assertPackagedWindowsUpdatePublisher(
  contents: string,
  expectedPublisher: string,
): void {
  const names = readPackagedUpdatePublisherNames(contents);
  if (names.length !== 1 || names[0] !== expectedPublisher) {
    throw new Error(
      `Packaged Windows updater must verify updates against publisher "${expectedPublisher}", received ${
        names.length > 0 ? names.map((name) => `"${name}"`).join(", ") : "no publisherName"
      }.`,
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
