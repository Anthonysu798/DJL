import { describe, expect, it } from "vitest";

import { STATS_COMMAND, parseStatsOutput } from "./stats";

const linux = `@@hostname
web-1
@@uname
Linux 6.8.0-45-generic
@@os
PRETTY_NAME="Ubuntu 24.04.1 LTS"
@@uptime
123456.78 400000.00
@@loadavg
0.42 0.35 0.30 1/512 12345
@@meminfo
MemTotal:        8123456 kB
MemAvailable:    5123456 kB
@@df
/dev/vda1 40000000 12345678 27654322 31% /
@@bsd_boottime
@@bsd_loadavg
`;

const macos = `@@hostname
studio.local
@@uname
Darwin 24.6.0
@@os
@@uptime
@@loadavg
@@meminfo
@@df
/dev/disk3s1s1 971350180 10485760 400000000 3% /
@@bsd_boottime
{ sec = 1700000000, usec = 0 } Tue Nov 14 22:13:20 2023
@@bsd_loadavg
{ 1.23 1.45 1.50 }
`;

describe("parseStatsOutput", () => {
  it("parses a Linux host", () => {
    const stats = parseStatsOutput(linux, 1_000_000);
    expect(stats.hostname).toBe("web-1");
    expect(stats.kernel).toBe("Linux 6.8.0-45-generic");
    expect(stats.os).toBe("Ubuntu 24.04.1 LTS");
    expect(stats.uptimeSeconds).toBe(123456);
    expect(stats.load).toEqual({ one: 0.42, five: 0.35, fifteen: 0.3 });
    expect(stats.memory).toEqual({
      totalBytes: 8123456 * 1024,
      usedBytes: (8123456 - 5123456) * 1024,
    });
    expect(stats.disk).toEqual({
      totalBytes: 40000000 * 1024,
      usedBytes: 12345678 * 1024,
      mountPoint: "/",
    });
    expect(stats.collectedAt).toBe(1_000_000);
  });

  it("parses a macOS host and degrades missing fields", () => {
    const now = 1_700_100_000_000;
    const stats = parseStatsOutput(macos, now);
    expect(stats.hostname).toBe("studio.local");
    expect(stats.os).toBeUndefined();
    expect(stats.memory).toBeUndefined();
    expect(stats.uptimeSeconds).toBe(100000);
    expect(stats.load).toEqual({ one: 1.23, five: 1.45, fifteen: 1.5 });
    expect(stats.disk?.mountPoint).toBe("/");
  });

  it("survives garbage", () => {
    const stats = parseStatsOutput("not the output you expect", 5);
    expect(stats).toEqual({ collectedAt: 5 });
  });

  it("uses only POSIX tools in the command", () => {
    expect(STATS_COMMAND).not.toMatch(/\b(bash|jq|python)\b/);
    expect(STATS_COMMAND).toContain("@@df");
  });
});
