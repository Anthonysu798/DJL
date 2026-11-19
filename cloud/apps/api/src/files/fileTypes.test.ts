import { describe, expect, it } from "vitest";
import { bytesMatchType, isImageType, isSupportedType } from "./fileTypes";
function ftyp(brand: string) {
  const bytes = new Uint8Array(24);
  new DataView(bytes.buffer).setUint32(0, 24);
  bytes.set(new TextEncoder().encode(`ftyp${brand}`), 4);
  bytes.set(new TextEncoder().encode("isommp42"), 16);
  return bytes;
}
describe("MP4 upload signature", () => {
  it("supports MP4 without treating it as an image", () => {
    expect(isSupportedType("video/mp4")).toBe(true);
    expect(isImageType("video/mp4")).toBe(false);
    expect(bytesMatchType("video/mp4", ftyp("mp42"))).toBe(true);
  });
  it.each(["avif", "heic", "M4A ", "qt  "])(
    "rejects non-video or unsupported major brand %s",
    (brand) => {
      expect(bytesMatchType("video/mp4", ftyp(brand))).toBe(false);
    },
  );
  it("rejects truncated, malformed, or merely renamed files", () => {
    expect(bytesMatchType("video/mp4", ftyp("mp42").subarray(0, 20))).toBe(false);
    const invalid = ftyp("mp42");
    new DataView(invalid.buffer).setUint32(0, 1);
    expect(bytesMatchType("video/mp4", invalid)).toBe(false);
    expect(bytesMatchType("video/mp4", new TextEncoder().encode("not a video ftypmp42"))).toBe(
      false,
    );
  });
});
