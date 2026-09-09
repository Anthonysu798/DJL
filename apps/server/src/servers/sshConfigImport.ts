// FILE: sshConfigImport.ts
// Purpose: Read concrete Host entries from ~/.ssh/config for one-click import.
// Layer: Servers domain helpers
import { Effect, FileSystem, Path } from "effect";

export interface ParsedSshHost {
  readonly alias: string;
  readonly hostName: string;
  readonly port: number;
  readonly user?: string;
  readonly identityFile?: string;
}

const isConcreteAlias = (alias: string) => !/[*?!]/.test(alias);

export function parseSshConfig(text: string): { hosts: ParsedSshHost[]; includes: string[] } {
  const hosts: ParsedSshHost[] = [];
  const includes: string[] = [];
  let currentAliases: string[] = [];
  let current: { hostName?: string; port?: number; user?: string; identityFile?: string } = {};

  const flush = () => {
    for (const alias of currentAliases) {
      hosts.push({
        alias,
        hostName: current.hostName ?? alias,
        port: current.port ?? 22,
        ...(current.user ? { user: current.user } : {}),
        ...(current.identityFile ? { identityFile: current.identityFile } : {}),
      });
    }
    currentAliases = [];
    current = {};
  };

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    const match = /^(\S+?)(?:\s*=\s*|\s+)(.+)$/.exec(line);
    if (!match?.[1] || !match[2]) continue;
    const keyword = match[1].toLowerCase();
    const value = match[2].trim();
    if (keyword === "include") {
      includes.push(...value.split(/\s+/));
      continue;
    }
    if (keyword === "host") {
      flush();
      currentAliases = value.split(/\s+/).filter(isConcreteAlias);
      continue;
    }
    if (keyword === "match") {
      flush();
      continue;
    }
    if (currentAliases.length === 0) continue;
    if (keyword === "hostname") current.hostName = value;
    else if (keyword === "port") {
      const port = Number(value);
      if (Number.isInteger(port) && port > 0 && port <= 65535) current.port = port;
    } else if (keyword === "user") current.user = value;
    else if (keyword === "identityfile" && current.identityFile === undefined) {
      current.identityFile = value.replace(/^"|"$/g, "");
    }
  }
  flush();
  return { hosts, includes };
}

export function expandHomePath(input: string, homeDir: string): string {
  if (input === "~") return homeDir;
  if (input.startsWith("~/")) {
    return `${homeDir}${input.slice(1)}`.replace(/\//g, homeDir.includes("\\") ? "\\" : "/");
  }
  return input;
}

const globToRegExp = (glob: string) =>
  new RegExp(
    `^${glob
      .split("*")
      .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
      .join(".*")}$`,
  );

export const readSshConfigHosts = (homeDir: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const sshDir = path.join(homeDir, ".ssh");
    const configPath = path.join(sshDir, "config");
    const readText = (file: string) =>
      fileSystem.readFileString(file).pipe(Effect.orElseSucceed(() => null));

    const main = yield* readText(configPath);
    if (main === null) return { configPath, hosts: [] as ParsedSshHost[] };
    const parsed = parseSshConfig(main);
    const hosts: ParsedSshHost[] = [...parsed.hosts];

    for (const include of parsed.includes) {
      const expanded = expandHomePath(include, homeDir);
      const absolute = path.isAbsolute(expanded) ? expanded : path.join(sshDir, expanded);
      const dir = path.dirname(absolute);
      const base = path.basename(absolute);
      const entries = base.includes("*")
        ? yield* fileSystem.readDirectory(dir).pipe(Effect.orElseSucceed(() => [] as string[]))
        : [base];
      const pattern = globToRegExp(base);
      for (const entry of entries) {
        if (!pattern.test(entry)) continue;
        const text = yield* readText(path.join(dir, entry));
        if (text !== null) hosts.push(...parseSshConfig(text).hosts);
      }
    }
    return { configPath, hosts };
  });
