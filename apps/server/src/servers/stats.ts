// FILE: stats.ts
// Purpose: Single remote command for basic host stats plus a tolerant parser.
// Layer: Servers domain helpers
import type { ServerStats } from "@synara/contracts";

const section = (name: string, body: string) => `printf '@@${name}\\n'; ${body} 2>/dev/null;`;

export const STATS_COMMAND = [
  section("hostname", "hostname"),
  section("uname", "uname -sr"),
  section("os", "grep ^PRETTY_NAME= /etc/os-release"),
  section("uptime", "cat /proc/uptime"),
  section("loadavg", "cat /proc/loadavg"),
  section("meminfo", "grep -E '^(MemTotal|MemAvailable):' /proc/meminfo"),
  section("df", "df -Pk / | tail -1"),
  section("bsd_boottime", "sysctl -n kern.boottime"),
  section("bsd_loadavg", "sysctl -n vm.loadavg"),
  "true",
].join(" ");

function splitSections(stdout: string): Map<string, string[]> {
  const sections = new Map<string, string[]>();
  let current: string | null = null;
  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (line.startsWith("@@")) {
      current = line.slice(2).trim();
      sections.set(current, []);
      continue;
    }
    if (current !== null && line.trim().length > 0) sections.get(current)?.push(line.trim());
  }
  return sections;
}

const num = (value: string | undefined): number | undefined => {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

export function parseStatsOutput(stdout: string, collectedAt: number): ServerStats {
  const sections = splitSections(stdout);
  const first = (name: string) => sections.get(name)?.[0];
  const stats: { -readonly [K in keyof ServerStats]: ServerStats[K] } = { collectedAt };

  const hostname = first("hostname");
  if (hostname) stats.hostname = hostname;
  const kernel = first("uname");
  if (kernel) stats.kernel = kernel;
  const osLine = first("os");
  const osMatch = osLine ? /^PRETTY_NAME="?([^"]*)"?$/.exec(osLine) : null;
  if (osMatch?.[1]) stats.os = osMatch[1];

  const uptime = num(first("uptime")?.split(/\s+/)[0]);
  if (uptime !== undefined) stats.uptimeSeconds = Math.floor(uptime);
  else {
    const boot = /sec\s*=\s*(\d+)/.exec(first("bsd_boottime") ?? "");
    if (boot) {
      stats.uptimeSeconds = Math.max(0, Math.floor(collectedAt / 1000) - Number(boot[1]));
    }
  }

  const loadParts = first("loadavg")?.split(/\s+/) ?? [];
  const bsdLoad = /\{\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\}/.exec(first("bsd_loadavg") ?? "");
  const load =
    loadParts.length >= 3 ? loadParts : bsdLoad ? [bsdLoad[1], bsdLoad[2], bsdLoad[3]] : null;
  if (load) {
    const [one, five, fifteen] = [num(load[0]), num(load[1]), num(load[2])];
    if (one !== undefined && five !== undefined && fifteen !== undefined) {
      stats.load = { one, five, fifteen };
    }
  }

  const mem = new Map<string, number>();
  for (const line of sections.get("meminfo") ?? []) {
    const match = /^(MemTotal|MemAvailable):\s+(\d+)\s*kB$/.exec(line);
    if (match?.[1] && match[2]) mem.set(match[1], Number(match[2]) * 1024);
  }
  const memTotal = mem.get("MemTotal");
  const memAvailable = mem.get("MemAvailable");
  if (memTotal !== undefined && memAvailable !== undefined) {
    stats.memory = { totalBytes: memTotal, usedBytes: Math.max(0, memTotal - memAvailable) };
  }

  const df = first("df")?.split(/\s+/);
  if (df && df.length >= 6) {
    const total = num(df[1]);
    const used = num(df[2]);
    const mountPoint = df[df.length - 1];
    if (total !== undefined && used !== undefined && mountPoint !== undefined) {
      stats.disk = { totalBytes: total * 1024, usedBytes: used * 1024, mountPoint };
    }
  }

  return stats;
}
