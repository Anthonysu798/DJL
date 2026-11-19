import { describe, expect, it, vi } from "vitest";
import { TikTokProvider, inspectTikTokJpeg } from "./tiktok.ts";
import type { ProviderTokens } from "./types.ts";

const tokens: ProviderTokens = {
  accessToken: "fixture",
  scope: ["video.publish"],
  expiresAt: "2027-01-01T00:00:00Z",
};
const creator = {
  data: {
    creator_username: "creator",
    creator_nickname: "Creator",
    privacy_level_options: ["SELF_ONLY"],
    duet_disabled: true,
    stitch_disabled: true,
    comment_disabled: false,
    max_video_post_duration_sec: 60,
  },
  error: { code: "ok" },
};
const photo = {
  photoUrl: "https://media.example/approved.jpg",
  description: "A full caption longer than a photo title. ".repeat(8),
  privacyLevel: "SELF_ONLY",
  disableComment: false,
  brandContent: false,
  brandOrganic: true,
  isAigc: true,
};
function setup(...responses: unknown[]) {
  const fetcher = Object.assign(vi.fn(), { preconnect: vi.fn() });
  for (const body of responses) fetcher.mockResolvedValueOnce(Response.json(body));
  return {
    fetcher,
    provider: new TikTokProvider(
      { clientKey: "fixture", clientSecret: "fixture" },
      { fetch: fetcher as typeof fetch },
    ),
  };
}
// A small baseline JPEG; only the SOF dimension bytes are varied in metadata tests.
const jpeg = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAb/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdAAr/2Q==",
  "base64",
);
function image(width: number, height: number) {
  const bytes = Uint8Array.from(jpeg);
  const frame = bytes.findIndex((b, i) => b === 0xff && bytes[i + 1] === 0xc0);
  const view = new DataView(bytes.buffer);
  view.setUint16(frame + 5, height);
  view.setUint16(frame + 7, width);
  return bytes;
}
describe("TikTok photo Direct Post", () => {
  it("rejects video captions above their separate UTF-16 limit before requesting publication", async () => {
    const { provider, fetcher } = setup(creator, {
      data: { publish_id: "receipt" },
      error: { code: "ok" },
    });
    await expect(
      provider.publishVideo(tokens, {
        ...photo,
        videoUrl: "https://media.example/approved.mp4",
        title: "😀".repeat(1101),
        disableDuet: true,
        disableStitch: true,
      }),
    ).rejects.toMatchObject({ kind: "rejected" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("uses the photo endpoint and preserves the full description and disclosure without automatic music", async () => {
    const { provider, fetcher } = setup(creator, {
      data: { publish_id: "receipt" },
      error: { code: "ok" },
    });
    expect(await provider.publishPhoto(tokens, photo)).toEqual({ publishId: "receipt" });
    expect(fetcher.mock.calls[0]![0]).toBe(
      "https://open.tiktokapis.com/v2/post/publish/creator_info/query/",
    );
    expect(fetcher.mock.calls[1]![0]).toBe(
      "https://open.tiktokapis.com/v2/post/publish/content/init/",
    );
    expect(JSON.parse(fetcher.mock.calls[1]![1].body)).toEqual({
      media_type: "PHOTO",
      post_mode: "DIRECT_POST",
      is_aigc: true,
      post_info: {
        description: photo.description,
        privacy_level: "SELF_ONLY",
        disable_comment: false,
        brand_content_toggle: false,
        brand_organic_toggle: true,
        auto_add_music: false,
      },
      source_info: {
        source: "PULL_FROM_URL",
        photo_images: [photo.photoUrl],
        photo_cover_index: 0,
      },
    });
  });
  it.each([
    { privacyLevel: "PUBLIC_TO_EVERYONE" },
    { brandContent: true },
    { description: "😀".repeat(2001) },
  ])("rejects invalid photo choices before the write: %j", async (patch) => {
    const { provider, fetcher } = setup(creator);
    await expect(provider.publishPhoto(tokens, { ...photo, ...patch })).rejects.toMatchObject({
      kind: "rejected",
    });
    expect(fetcher.mock.calls.some(([url]) => String(url).endsWith("/content/init/"))).toBe(false);
  });
  it("sends ordered photo URLs and the selected cover in one publication request", async () => {
    const { provider, fetcher } = setup(creator, {
      data: { publish_id: "receipt" },
      error: { code: "ok" },
    });
    const photoUrls = [
      "https://media.example/third.jpg",
      "https://media.example/first.jpg",
      "https://media.example/second.jpg",
    ];
    await provider.publishPhoto(tokens, { ...photo, photoUrls, photoCoverIndex: 2 });
    expect(JSON.parse(fetcher.mock.calls[1]![1].body).source_info).toEqual({
      source: "PULL_FROM_URL",
      photo_images: photoUrls,
      photo_cover_index: 2,
    });
    expect(
      fetcher.mock.calls.filter(([url]) => String(url).endsWith("/content/init/")),
    ).toHaveLength(1);
  });
  it("accepts all 35 photo URLs and the last cover index", async () => {
    const { provider, fetcher } = setup(creator, {
      data: { publish_id: "receipt" },
      error: { code: "ok" },
    });
    const photoUrls = Array.from(
      { length: 35 },
      (_, index) => `https://media.example/${index}.jpg`,
    );
    await provider.publishPhoto(tokens, { ...photo, photoUrls, photoCoverIndex: 34 });
    expect(JSON.parse(fetcher.mock.calls[1]![1].body).source_info).toEqual({
      source: "PULL_FROM_URL",
      photo_images: photoUrls,
      photo_cover_index: 34,
    });
  });
  it.each([
    { photoUrls: [] },
    { photoUrls: Array(36).fill("https://media.example/a.jpg") },
    { photoCoverIndex: -1 },
    { photoCoverIndex: 1 },
    { photoCoverIndex: 0.5 },
  ])("rejects invalid carousel bounds before any network call: %j", async (patch) => {
    const { provider, fetcher } = setup();
    await expect(provider.publishPhoto(tokens, { ...photo, ...patch })).rejects.toMatchObject({
      kind: "rejected",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("honors changed comment permissions and missing publish scope", async () => {
    const { provider, fetcher } = setup({
      ...creator,
      data: { ...creator.data, comment_disabled: true },
    });
    await expect(provider.publishPhoto(tokens, photo)).rejects.toMatchObject({ kind: "rejected" });
    await expect(provider.publishPhoto({ ...tokens, scope: [] }, photo)).rejects.toMatchObject({
      kind: "missing_scope",
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("keeps an accepted photo write without a receipt uncertain and does not retry", async () => {
    const { provider, fetcher } = setup(creator, { data: {}, error: { code: "ok" } });
    await expect(provider.publishPhoto(tokens, photo)).rejects.toMatchObject({ kind: "uncertain" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("accepts the photo description UTF-16 boundary without truncation", async () => {
    const { provider, fetcher } = setup(creator, {
      data: { publish_id: "receipt" },
      error: { code: "ok" },
    });
    const description = "😀".repeat(2000);
    await provider.publishPhoto(tokens, { ...photo, description });
    expect(JSON.parse(fetcher.mock.calls[1]![1].body).post_info.description).toBe(description);
  });
});
describe("TikTok JPEG metadata gate", () => {
  it.each([
    [1920, 1080],
    [1080, 1920],
    [1080, 1080],
    [1, 1],
  ])("accepts bounded JPEG dimensions %j x %j", (width, height) => {
    expect(inspectTikTokJpeg(image(width!, height!))).toEqual({ width, height });
  });
  it.each([
    [1921, 1080],
    [1080, 1921],
    [1081, 1081],
    [0, 1],
    [1, 0],
  ])("rejects unsupported dimensions %j x %j without resizing", (width, height) => {
    expect(inspectTikTokJpeg(image(width!, height!))).toBeNull();
  });
  it("rejects truncated, missing-frame and oversized JPEG data", () => {
    expect(inspectTikTokJpeg(jpeg.subarray(0, 20))).toBeNull();
    expect(inspectTikTokJpeg(new Uint8Array([255, 216, 255, 217]))).toBeNull();
    const oversized = new Uint8Array(20 * 1024 * 1024 + 1);
    oversized.set(jpeg);
    expect(inspectTikTokJpeg(oversized)).toBeNull();
  });
  it("rejects a truncated scan header rather than trusting the earlier dimensions", () => {
    const bytes = image(1080, 1920);
    const scan = bytes.findIndex((b, i) => b === 0xff && bytes[i + 1] === 0xda);
    new DataView(bytes.buffer).setUint16(scan + 2, 2);
    expect(inspectTikTokJpeg(bytes)).toBeNull();
  });
});
