import { describe, expect, it } from "vitest";
import { inspectMp4 } from "./mp4.ts";
function box(type: string, ...parts: Uint8Array[]) {
  const size = 8 + parts.reduce((n, p) => n + p.length, 0);
  const bytes = new Uint8Array(size);
  new DataView(bytes.buffer).setUint32(0, size);
  bytes.set(new TextEncoder().encode(type), 4);
  let at = 8;
  for (const p of parts) {
    bytes.set(p, at);
    at += p.length;
  }
  return bytes;
}
function video(codec = "avc1") {
  const header = new Uint8Array(20);
  const v = new DataView(header.buffer);
  v.setUint32(12, 1000);
  v.setUint32(16, 12000);
  const sampleHeader = new Uint8Array(8);
  new DataView(sampleHeader.buffer).setUint32(4, 1);
  return box(
    "moov",
    box("mvhd", header),
    box("trak", box("mdia", box("minf", box("stbl", box("stsd", sampleHeader, box(codec)))))),
  );
}
describe("bounded MP4 inspection", () => {
  it("reads duration and supported codec from owned bytes", () => {
    expect(inspectMp4(video())).toEqual({ durationSeconds: 12, codec: "avc1" });
  });
  it("rejects truncation, zero size, unknown codec and missing tracks", () => {
    expect(inspectMp4(video().slice(0, -1))).toBeNull();
    const invalid = video();
    new DataView(invalid.buffer).setUint32(0, 0);
    expect(inspectMp4(invalid)).toBeNull();
    expect(inspectMp4(video("xxxx"))).toBeNull();
    expect(inspectMp4(new Uint8Array(100))).toBeNull();
  });
});
