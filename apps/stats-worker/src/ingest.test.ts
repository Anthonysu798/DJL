import { describe, expect, it } from "vitest";

import { normalizeCountry, parseDownloadEvent, parseInstallEvent } from "./ingest";

describe("parseDownloadEvent", () => {
  it("accepts a complete event and normalizes the country", () => {
    expect(
      parseDownloadEvent({
        platform: "mac",
        arch: "arm64",
        source: "oss",
        country: "cn",
        version: "0.5.6",
      }),
    ).toEqual({ platform: "mac", arch: "arm64", source: "oss", country: "CN", version: "0.5.6" });
  });

  it("treats country and version as optional", () => {
    expect(parseDownloadEvent({ platform: "windows", arch: "x64", source: "vps" })).toEqual({
      platform: "windows",
      arch: "x64",
      source: "vps",
      country: null,
      version: null,
    });
  });

  it("rejects unknown platforms, arches, sources, and malformed versions", () => {
    expect(parseDownloadEvent({ platform: "linux", arch: "x64", source: "github" })).toBeNull();
    expect(parseDownloadEvent({ platform: "mac", arch: "sparc", source: "github" })).toBeNull();
    expect(parseDownloadEvent({ platform: "mac", arch: "x64", source: "torrent" })).toBeNull();
    expect(
      parseDownloadEvent({ platform: "mac", arch: "x64", source: "github", version: "latest" }),
    ).toBeNull();
    expect(parseDownloadEvent(null)).toBeNull();
    expect(parseDownloadEvent("mac")).toBeNull();
  });
});

describe("parseInstallEvent", () => {
  const installId = "6f1c2c0e-2b3a-4c4d-9e8f-0a1b2c3d4e5f";

  it("accepts a complete event", () => {
    expect(
      parseInstallEvent({
        installId,
        version: "0.5.6",
        platform: "darwin",
        arch: "arm64",
        channel: "djl",
      }),
    ).toEqual({ installId, version: "0.5.6", platform: "darwin", arch: "arm64", channel: "djl" });
  });

  it("treats channel as optional", () => {
    expect(
      parseInstallEvent({ installId, version: "0.5.6", platform: "win32", arch: "x64" }),
    ).toEqual({
      installId,
      version: "0.5.6",
      platform: "win32",
      arch: "x64",
      channel: null,
    });
  });

  it("rejects non-UUID ids and unknown platforms", () => {
    expect(
      parseInstallEvent({
        installId: "not-a-uuid",
        version: "0.5.6",
        platform: "darwin",
        arch: "x64",
      }),
    ).toBeNull();
    expect(
      parseInstallEvent({ installId, version: "0.5.6", platform: "mac", arch: "x64" }),
    ).toBeNull();
    expect(
      parseInstallEvent({
        installId,
        version: "0.5.6",
        platform: "darwin",
        arch: "x64",
        channel: 7,
      }),
    ).toBeNull();
  });
});

describe("normalizeCountry", () => {
  it("uppercases two-letter codes and rejects everything else", () => {
    expect(normalizeCountry("cn")).toBe("CN");
    expect(normalizeCountry("US")).toBe("US");
    expect(normalizeCountry("USA")).toBeNull();
    expect(normalizeCountry("")).toBeNull();
    expect(normalizeCountry(undefined)).toBeNull();
  });
});
