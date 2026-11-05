import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
  DESCRIPTOR_SIZE,
  MAX_IMAGE_BYTES,
  LOCAL_PRODUCT_IMAGES,
  cropBounds,
  describePixels,
  descriptorDistance,
  rankCatalog,
  searchCatalogImage,
  createCatalogSample,
} from "../apps/web/public/shop/image-search.mjs";

const integerCrop = (bounds) => ({
  left: Math.round(bounds.x),
  top: Math.round(bounds.y),
  width: Math.round(bounds.width),
  height: Math.round(bounds.height),
});
function pixels(paint) {
  const data = new Uint8ClampedArray(DESCRIPTOR_SIZE ** 2 * 4);
  for (let y = 0; y < DESCRIPTOR_SIZE; y += 1) {
    for (let x = 0; x < DESCRIPTOR_SIZE; x += 1) {
      data.set(paint(x, y), (y * DESCRIPTOR_SIZE + x) * 4);
    }
  }
  return { width: DESCRIPTOR_SIZE, height: DESCRIPTOR_SIZE, data };
}
const vertical = () =>
  describePixels(pixels((x) => (x > 10 && x < 21 ? [30, 40, 50, 255] : [225, 220, 210, 255])));
const horizontal = () =>
  describePixels(pixels((_x, y) => (y > 10 && y < 21 ? [30, 40, 50, 255] : [225, 220, 210, 255])));
const catalog = () => [
  { id: "vertical-product", descriptor: vertical() },
  { id: "horizontal-product", descriptor: horizontal() },
];

test("rank changes with actual query pixels, independent of names or catalog order", () => {
  assert.equal(rankCatalog(vertical(), catalog()).matches[0].id, "vertical-product");
  assert.equal(rankCatalog(horizontal(), catalog()).matches[0].id, "horizontal-product");
  assert.equal(rankCatalog(vertical(), catalog().toReversed()).matches[0].id, "vertical-product");
  assert.equal(descriptorDistance(vertical(), vertical()), 0);
  assert.ok(descriptorDistance(vertical(), horizontal()) > 0.14);
});

test("blank and unrelated high-detail images can return no matches", () => {
  const blank = describePixels(pixels(() => [255, 255, 255, 255]));
  const unrelated = describePixels(
    pixels((x, y) => ((x + y) % 2 ? [255, 0, 0, 255] : [0, 0, 255, 255])),
  );
  assert.deepEqual(rankCatalog(blank, catalog()).matches, []);
  assert.equal(rankCatalog(blank, catalog()).reason, "insufficient-detail");
  assert.equal(rankCatalog(unrelated, catalog()).reason, "no-match");
  assert.deepEqual(rankCatalog(vertical(), []), {
    matches: [],
    reason: "no-match",
    method: "local-visual",
  });
});

test("transparent pixels composite over white and invalid descriptor input is rejected", () => {
  const transparent = describePixels(pixels(() => [0, 0, 0, 0]));
  assert.ok(transparent.colors.every((channel) => channel === 1));
  assert.equal(transparent.contrast, 0);
  assert.throws(() => describePixels({ data: new Uint8Array(4), width: 1, height: 1 }), /32/);
});

test("crop boundaries preserve exact normalized pixel coordinates", () => {
  assert.deepEqual(cropBounds(1920, 1080, "full"), { x: 0, y: 0, width: 1920, height: 1080 });
  assert.deepEqual(cropBounds(1920, 1080), { x: 420, y: 0, width: 1080, height: 1080 });
  assert.deepEqual(cropBounds(1000, 800, { x: 0.125, y: 0.25, width: 0.5, height: 0.5 }), {
    x: 125,
    y: 200,
    width: 500,
    height: 400,
  });
  for (const crop of [
    null,
    {},
    { x: -0.1, y: 0, width: 1, height: 1 },
    { x: 0.5, y: 0, width: 1, height: 1 },
    { x: 0, y: 0, width: NaN, height: 1 },
    { x: 0, y: 0, width: 0.001, height: 1 },
  ]) {
    assert.throws(() => cropBounds(1000, 800, crop), /框选/);
  }
  assert.throws(() => cropBounds(7, 7), /太小/);
});

test("all four catalog regions use real product IDs and local quadrants", () => {
  assert.deepEqual(
    LOCAL_PRODUCT_IMAGES.map((entry) => entry.id),
    ["tote", "lamp", "tumbler", "organizer"],
  );
  assert.equal(new Set(LOCAL_PRODUCT_IMAGES.map((entry) => entry.imageUrl)).size, 1);
  assert.deepEqual(LOCAL_PRODUCT_IMAGES[3].crop, { x: 0.5, y: 0.5, width: 0.5, height: 0.5 });
});

test("invalid images fail before browser decoding or catalog access", async () => {
  await assert.rejects(searchCatalogImage(null), /有效图片/);
  await assert.rejects(searchCatalogImage(new Blob([], { type: "image/png" })), /有效图片/);
  await assert.rejects(searchCatalogImage(new Blob(["text"], { type: "text/plain" })), /仅支持/);
  await assert.rejects(
    searchCatalogImage(new Blob(["not png"], { type: "image/png" })),
    /内容不符/,
  );
  await assert.rejects(
    searchCatalogImage(new Blob([new Uint8Array(MAX_IMAGE_BYTES + 1)], { type: "image/png" })),
    /10 MB/,
  );
  await assert.rejects(createCatalogSample("missing-product"), /不存在/);
});

test("external catalog URLs and duplicate IDs are rejected without fetching", async () => {
  const validHeader = new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], {
    type: "image/png",
  });
  await assert.rejects(
    searchCatalogImage(validHeader, [
      { id: "external", imageUrl: "https://example.invalid/photo.png" },
    ]),
    /本地素材/,
  );
  await assert.rejects(
    searchCatalogImage(validHeader, [LOCAL_PRODUCT_IMAGES[0], LOCAL_PRODUCT_IMAGES[0]]),
    /索引无效/,
  );
  assert.deepEqual(await searchCatalogImage(null, []), {
    matches: [],
    reason: "no-match",
    method: "local-visual",
  });
});

test("pre-aborted searches and ranking stop without decoding or results", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    searchCatalogImage(null, LOCAL_PRODUCT_IMAGES, { signal: controller.signal }),
    { name: "AbortError" },
  );
  await assert.rejects(createCatalogSample("tote", { signal: controller.signal }), {
    name: "AbortError",
  });
  assert.throws(() => rankCatalog(vertical(), catalog(), { signal: controller.signal }), {
    name: "AbortError",
  });
});

test("actual four catalog images rank themselves first after lossy re-encoding", async () => {
  // Sharp is already a declared server dependency; the browser engine has no native dependency.
  const sharp = createRequire(new URL("../apps/server/package.json", import.meta.url))("sharp");
  const source = new URL("../apps/web/public/shop/assets/products.png", import.meta.url);
  const { fileURLToPath } = await import("node:url");
  const filename = fileURLToPath(source);
  const metadata = await sharp(filename).metadata();
  const samples = [];
  for (const entry of LOCAL_PRODUCT_IMAGES) {
    const crop = cropBounds(metadata.width, metadata.height, entry.crop);
    const image = await sharp(filename)
      .extract({ left: crop.x, top: crop.y, width: crop.width, height: crop.height })
      .png()
      .toBuffer();
    const raw = await sharp(image).resize(32, 32).ensureAlpha().raw().toBuffer();
    samples.push({
      id: entry.id,
      image,
      descriptor: describePixels({ data: raw, width: 32, height: 32 }),
    });
  }
  for (const sample of samples) {
    const jpeg = await sharp(sample.image).resize(256, 256).jpeg({ quality: 55 }).toBuffer();
    const raw = await sharp(jpeg).resize(32, 32).ensureAlpha().raw().toBuffer();
    const query = describePixels({ data: raw, width: 32, height: 32 });
    const result = rankCatalog(query, samples);
    assert.equal(result.reason, "matched", sample.id);
    assert.equal(result.matches[0].id, sample.id);
    assert.deepEqual(
      result.matches.map((match) => match.id),
      [sample.id],
    );
    assert.ok(result.matches[0].distance < 0.04, `${sample.id}: ${result.matches[0].distance}`);
    const scaled = await sharp(sample.image).resize(256, 256).png().toBuffer();
    const modified = await sharp(scaled)
      .extract({ left: 12, top: 12, width: 232, height: 232 })
      .modulate({ brightness: 0.9 })
      .resize(32, 32)
      .ensureAlpha()
      .raw()
      .toBuffer();
    const reframed = rankCatalog(
      describePixels({ data: modified, width: 32, height: 32 }),
      samples,
    );
    assert.equal(reframed.matches[0]?.id, sample.id, `slightly reframed ${sample.id}`);
  }
});

test("matches a framed built-in tumbler against equally framed references without guessing blank or unrelated images", async () => {
  const { referenceCropForSample } = await import("../apps/web/public/shop/image-search.mjs");
  const sharp = createRequire(new URL("../apps/server/package.json", import.meta.url))("sharp");
  const { fileURLToPath } = await import("node:url");
  const source = fileURLToPath(
    new URL("../apps/web/public/shop/assets/products.png", import.meta.url),
  );
  const { width, height } = await sharp(source).metadata();
  const frame = { x: 0.2, y: 0.08, width: 0.6, height: 0.84 };
  const descriptor = async (image, bounds) => {
    const data = await sharp(image)
      .extract(integerCrop(bounds))
      .resize(DESCRIPTOR_SIZE, DESCRIPTOR_SIZE)
      .ensureAlpha()
      .raw()
      .toBuffer();
    return describePixels({ data, width: DESCRIPTOR_SIZE, height: DESCRIPTOR_SIZE });
  };
  const all = await Promise.all(
    LOCAL_PRODUCT_IMAGES.map(async (entry) => ({
      id: entry.id,
      descriptor: await descriptor(source, cropBounds(width, height, entry.crop)),
    })),
  );
  const tumbler = LOCAL_PRODUCT_IMAGES.find((entry) => entry.id === "tumbler");
  const sample = await sharp(source)
    .extract(integerCrop(cropBounds(width, height, tumbler.crop)))
    .resize(512, 512)
    .png()
    .toBuffer();
  const query = await descriptor(sample, cropBounds(512, 512, frame));
  assert.equal(rankCatalog(query, all).reason, "no-match", "unframed lookup stays conservative");

  const sameFrame = await Promise.all(
    LOCAL_PRODUCT_IMAGES.map(async (entry) => {
      const region = referenceCropForSample?.(width, height, entry.crop, frame) ?? entry.crop;
      return {
        id: entry.id,
        descriptor: await descriptor(source, cropBounds(width, height, region)),
      };
    }),
  );
  assert.deepEqual(
    rankCatalog(query, sameFrame).matches.map((entry) => entry.id),
    ["tumbler"],
  );
  const blank = describePixels(pixels(() => [255, 255, 255, 255]));
  const unrelated = describePixels(
    pixels((x, y) => ((x + y) % 2 ? [255, 0, 0, 255] : [0, 0, 255, 255])),
  );
  assert.equal(rankCatalog(blank, sameFrame).reason, "insufficient-detail");
  assert.equal(rankCatalog(unrelated, sameFrame).reason, "no-match");
});

test("failed custom crops and decoder dimension rejection release bitmaps", async () => {
  const original = globalThis.createImageBitmap;
  let closed = 0;
  const file = new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], { type: "image/png" });
  try {
    globalThis.createImageBitmap = async () => ({
      width: 32,
      height: 32,
      close() {
        closed += 1;
      },
    });
    await assert.rejects(searchCatalogImage(file, LOCAL_PRODUCT_IMAGES, { crop: {} }), /框选/);
    assert.equal(closed, 1);
    globalThis.createImageBitmap = async () => ({
      width: 20000,
      height: 20000,
      close() {
        closed += 1;
      },
    });
    await assert.rejects(searchCatalogImage(file), /分辨率/);
    assert.equal(closed, 2);
  } finally {
    if (original === undefined) delete globalThis.createImageBitmap;
    else globalThis.createImageBitmap = original;
  }
});

test("cancellation rejects pending decoding and closes the late bitmap", async () => {
  const original = globalThis.createImageBitmap;
  const controller = new AbortController();
  let finish;
  let started;
  let closed = 0;
  const ready = new Promise((resolve) => {
    started = resolve;
  });
  try {
    globalThis.createImageBitmap = () => {
      started();
      return new Promise((resolve) => {
        finish = resolve;
      });
    };
    const file = new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], {
      type: "image/png",
    });
    const result = searchCatalogImage(file, LOCAL_PRODUCT_IMAGES, { signal: controller.signal });
    await ready;
    controller.abort();
    await assert.rejects(result, { name: "AbortError" });
    finish({
      width: 32,
      height: 32,
      close() {
        closed += 1;
      },
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(closed, 1);
  } finally {
    if (original === undefined) delete globalThis.createImageBitmap;
    else globalThis.createImageBitmap = original;
  }
});

test("CSP-compatible catalog harness loads through Image, never fetch, and releases resources", async () => {
  const original = new Map(
    ["Image", "document", "createImageBitmap", "fetch"].map((key) => [key, globalThis[key]]),
  );
  let closed = 0;
  let removed = 0;
  let fetches = 0;
  const urls = [];
  const drawn = [];
  const verticalPixels = pixels((x) =>
    x > 10 && x < 21 ? [30, 40, 50, 255] : [225, 220, 210, 255],
  );
  const horizontalPixels = pixels((_x, y) =>
    y > 10 && y < 21 ? [30, 40, 50, 255] : [225, 220, 210, 255],
  );
  try {
    globalThis.fetch = () => {
      fetches += 1;
      throw new Error("connect-src none");
    };
    globalThis.Image = class extends EventTarget {
      set src(url) {
        urls.push(url);
        queueMicrotask(() => this.dispatchEvent(new Event("load")));
      }
      removeAttribute(name) {
        assert.equal(name, "src");
        removed += 1;
      }
    };
    globalThis.createImageBitmap = async (source) => ({
      width: source instanceof Blob ? 512 : 1254,
      height: source instanceof Blob ? 512 : 1254,
      query: source instanceof Blob,
      close() {
        closed += 1;
      },
    });
    globalThis.document = {
      createElement(tag) {
        assert.equal(tag, "canvas");
        let draw;
        return {
          getContext() {
            return {
              fillRect() {},
              drawImage(source, x, y, width, height) {
                draw = { source, x, y };
                drawn.push([source.query, x, y, width, height]);
              },
              getImageData() {
                return draw.source.query || (!draw.x && !draw.y)
                  ? verticalPixels
                  : horizontalPixels;
              },
            };
          },
          toBlob(callback) {
            callback(
              new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], { type: "image/png" }),
            );
          },
        };
      },
    };
    const sample = await createCatalogSample("tote");
    const result = await searchCatalogImage(sample);
    assert.equal(result.matches[0].id, "tote");
    assert.equal(fetches, 0);
    assert.equal(closed, 3);
    assert.equal(removed, 2);
    assert.deepEqual(urls, [LOCAL_PRODUCT_IMAGES[0].imageUrl, LOCAL_PRODUCT_IMAGES[0].imageUrl]);
    drawn.length = 0;
    await searchCatalogImage(sample, LOCAL_PRODUCT_IMAGES, {
      sampleFraming: true,
      crop: { x: 0.25, y: 0.125, width: 0.5, height: 0.75 },
    });
    assert.deepEqual(
      drawn.map(([query, ...bounds]) =>
        [query].concat(bounds.map((value) => Number(value.toFixed(6)))),
      ),
      [
        [true, 128, 64, 256, 384],
        [false, 156.75, 78.375, 313.5, 470.25],
        [false, 783.75, 78.375, 313.5, 470.25],
        [false, 156.75, 705.375, 313.5, 470.25],
        [false, 783.75, 705.375, 313.5, 470.25],
      ],
    );
    assert.equal(fetches, 0);
    assert.equal(closed, 5);
    assert.equal(removed, 3);
  } finally {
    for (const [key, value] of original) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  }
});

test("catalog Image loading supports load errors and pending-load cancellation", async () => {
  const original = globalThis.Image;
  let removed = 0;
  try {
    globalThis.Image = class extends EventTarget {
      set src(_url) {
        queueMicrotask(() => this.dispatchEvent(new Event("error")));
      }
      removeAttribute() {
        removed += 1;
      }
    };
    await assert.rejects(createCatalogSample("tote"), /暂时无法读取/);
    assert.equal(removed, 1);
    const controller = new AbortController();
    globalThis.Image = class extends EventTarget {
      set src(_url) {}
      removeAttribute() {
        removed += 1;
      }
    };
    const result = createCatalogSample("tote", { signal: controller.signal });
    controller.abort();
    await assert.rejects(result, { name: "AbortError" });
    assert.equal(removed, 2);
  } finally {
    if (original === undefined) delete globalThis.Image;
    else globalThis.Image = original;
  }
});
