// Local appearance matching only: no semantic model, upload, account, or image storage.
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const DESCRIPTOR_SIZE = 32;
const ASSET_BASE = new URL("./assets/", import.meta.url);
const SPRITE_URL = new URL("products.png", ASSET_BASE).href;
export const LOCAL_PRODUCT_IMAGES = Object.freeze(
  ["tote", "lamp", "tumbler", "organizer"].map((id, index) =>
    Object.freeze({
      id,
      imageUrl: SPRITE_URL,
      crop: Object.freeze({
        x: (index % 2) / 2,
        y: Math.floor(index / 2) / 2,
        width: 0.5,
        height: 0.5,
      }),
    }),
  ),
);

function checkAbort(signal) {
  if (signal?.aborted) throw new DOMException("图片查找已取消", "AbortError");
}

export function cropBounds(width, height, crop = "center") {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 8 || height < 8) {
    throw new Error("图片尺寸太小，无法匹配");
  }
  if (crop === "full") return { x: 0, y: 0, width, height };
  if (crop === "center") {
    const size = Math.min(width, height);
    return { x: (width - size) / 2, y: (height - size) / 2, width: size, height: size };
  }
  if (
    !crop ||
    ![crop.x, crop.y, crop.width, crop.height].every(Number.isFinite) ||
    crop.x < 0 ||
    crop.y < 0 ||
    crop.width <= 0 ||
    crop.height <= 0 ||
    crop.x + crop.width > 1.000001 ||
    crop.y + crop.height > 1.000001 ||
    crop.width * width < 8 ||
    crop.height * height < 8
  ) {
    throw new Error("请在图片内框选至少 8 × 8 像素的区域");
  }
  return {
    x: crop.x * width,
    y: crop.y * height,
    width: Math.min(crop.width, 1 - crop.x) * width,
    height: Math.min(crop.height, 1 - crop.y) * height,
  };
}

/** The built-in sample preserves its reference tile's framing; compare the same selected area. */
export function referenceCropForSample(width, height, referenceCrop, sampleCrop) {
  const tile = cropBounds(width, height, referenceCrop);
  return {
    x: (tile.x + tile.width * sampleCrop.x) / width,
    y: (tile.y + tile.height * sampleCrop.y) / height,
    width: (tile.width * Math.min(sampleCrop.width, 1 - sampleCrop.x)) / width,
    height: (tile.height * Math.min(sampleCrop.height, 1 - sampleCrop.y)) / height,
  };
}
export function describePixels({ data, width, height }) {
  if (
    width !== DESCRIPTOR_SIZE ||
    height !== DESCRIPTOR_SIZE ||
    data?.length !== width * height * 4
  ) {
    throw new Error("图像描述需要 32 × 32 的 RGBA 像素");
  }
  const colors = Array.from({ length: 8 * 8 * 3 }, () => 0);
  const gray = Array.from({ length: width * height }, () => 0);
  let sum = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel = y * width + x;
      const offset = pixel * 4;
      const alpha = data[offset + 3] / 255;
      const rgb = [0, 1, 2].map(
        (channel) => (data[offset + channel] * alpha + 255 * (1 - alpha)) / 255,
      );
      const cell = (Math.floor(y / 4) * 8 + Math.floor(x / 4)) * 3;
      for (let channel = 0; channel < 3; channel += 1) colors[cell + channel] += rgb[channel] / 16;
      gray[pixel] = rgb[0] * 0.299 + rgb[1] * 0.587 + rgb[2] * 0.114;
      sum += gray[pixel];
    }
  }
  const mean = sum / gray.length;
  const contrast = Math.sqrt(
    gray.reduce((total, value) => total + (value - mean) ** 2, 0) / gray.length,
  );
  const shape = [];
  const hash = [];
  for (let cell = 0; cell < 64; cell += 1) {
    const offset = cell * 3;
    const light = colors[offset] * 0.299 + colors[offset + 1] * 0.587 + colors[offset + 2] * 0.114;
    shape.push(Math.max(-3, Math.min(3, (light - mean) / Math.max(contrast, 0.05))));
    if (cell % 8 < 7) {
      const next =
        colors[offset + 3] * 0.299 + colors[offset + 4] * 0.587 + colors[offset + 5] * 0.114;
      hash.push(light > next);
    }
  }
  return { colors, shape, hash, contrast };
}

const rmse = (a, b) =>
  Math.sqrt(a.reduce((sum, value, index) => sum + (value - b[index]) ** 2, 0) / a.length);

export function descriptorDistance(first, second) {
  const color = rmse(first.colors, second.colors);
  const shape = rmse(first.shape, second.shape) / 4;
  const hash =
    first.hash.reduce((sum, value, index) => sum + Number(value !== second.hash[index]), 0) /
    first.hash.length;
  return color * 0.55 + shape * 0.3 + hash * 0.15;
}

export function rankCatalog(query, catalog, { signal } = {}) {
  checkAbort(signal);
  if (!Array.isArray(catalog) || !catalog.length)
    return { matches: [], reason: "no-match", method: "local-visual" };
  if (query.contrast < 0.025)
    return { matches: [], reason: "insufficient-detail", method: "local-visual" };
  const matches = catalog
    .map(({ id, descriptor }) => ({ id, distance: descriptorDistance(query, descriptor) }))
    .toSorted(
      (first, second) => first.distance - second.distance || first.id.localeCompare(second.id),
    );
  // A conservative appearance heuristic for this four-image demo, not an accuracy or confidence score.
  const accepted = matches.filter((match) => match.distance <= 0.11).slice(0, 3);
  return {
    matches: accepted,
    reason: accepted.length ? "matched" : "no-match",
    method: "local-visual",
  };
}

async function decodeImage(blob, signal) {
  checkAbort(signal);
  if (!(blob instanceof Blob) || !blob.size) throw new Error("请选择有效图片");
  if (blob.size > MAX_IMAGE_BYTES) throw new Error("图片最大支持 10 MB");
  if (!["image/jpeg", "image/png", "image/webp"].includes(blob.type))
    throw new Error("仅支持 JPEG、PNG、WebP 图片");
  const header = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
  checkAbort(signal);
  const isPng =
    header.length >= 8 &&
    [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => header[index] === value);
  const isJpeg = header[0] === 255 && header[1] === 216 && header[2] === 255;
  const isWebp =
    String.fromCharCode(...header.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...header.slice(8, 12)) === "WEBP";
  if (
    !(
      (blob.type === "image/png" && isPng) ||
      (blob.type === "image/jpeg" && isJpeg) ||
      (blob.type === "image/webp" && isWebp)
    )
  ) {
    throw new Error("图片格式与内容不符，请重新选择");
  }
  return decodeBitmap(blob, signal);
}

async function decodeBitmap(source, signal) {
  checkAbort(signal);
  if (typeof createImageBitmap !== "function")
    throw new Error("当前浏览器不支持本地图片解码，请使用新版浏览器");
  let bitmap;
  try {
    bitmap = await new Promise((resolve, reject) => {
      const abort = () => reject(new DOMException("图片查找已取消", "AbortError"));
      signal?.addEventListener("abort", abort, { once: true });
      Promise.resolve()
        .then(() => createImageBitmap(source, { imageOrientation: "from-image" }))
        .then(
          (image) => {
            signal?.removeEventListener("abort", abort);
            if (signal?.aborted) {
              image.close();
              abort();
            } else resolve(image);
          },
          (error) => {
            signal?.removeEventListener("abort", abort);
            reject(error);
          },
        );
    });
    checkAbort(signal);
    if (bitmap.width > 16384 || bitmap.height > 16384 || bitmap.width * bitmap.height > 24000000) {
      throw new Error("图片分辨率过大，请先缩小到 2400 万像素以内");
    }
    cropBounds(bitmap.width, bitmap.height, "full");
    return bitmap;
  } catch (error) {
    bitmap?.close();
    if (error?.name === "AbortError" || error?.message?.includes("图片")) throw error;
    throw new Error("无法解码这张图片，请重新选择 JPEG、PNG 或 WebP", { cause: error });
  }
}

function imageCanvas(image, crop, size = DESCRIPTOR_SIZE) {
  const bounds = cropBounds(image.width, image.height, crop);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("当前浏览器无法处理图片");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, size, size);
  context.drawImage(image, bounds.x, bounds.y, bounds.width, bounds.height, 0, 0, size, size);
  return { canvas, context };
}

function catalogUrl(entry) {
  const url = new URL(entry.imageUrl, import.meta.url);
  if (
    url.protocol !== ASSET_BASE.protocol ||
    url.host !== ASSET_BASE.host ||
    !url.pathname.startsWith(ASSET_BASE.pathname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error("商品图片必须来自商城本地素材目录");
  return url.href;
}

async function loadCatalogImage(entry, signal) {
  checkAbort(signal);
  const url = catalogUrl(entry);
  const image = new Image();
  image.decoding = "async";
  image.referrerPolicy = "no-referrer";
  try {
    // img-src self is permitted while connect-src none deliberately blocks fetch.
    await new Promise((resolve, reject) => {
      const cleanup = () => {
        image.removeEventListener("load", loaded);
        image.removeEventListener("error", failed);
        signal?.removeEventListener("abort", abort);
      };
      const abort = () => {
        cleanup();
        reject(new DOMException("图片查找已取消", "AbortError"));
      };
      const loaded = () => {
        cleanup();
        resolve();
      };
      const failed = () => {
        cleanup();
        reject(new Error("商品图片暂时无法读取，请稍后重试"));
      };
      image.addEventListener("load", loaded, { once: true });
      image.addEventListener("error", failed, { once: true });
      signal?.addEventListener("abort", abort, { once: true });
      image.src = url;
    });
    return await decodeBitmap(image, signal);
  } finally {
    image.removeAttribute("src");
  }
}

export async function searchCatalogImage(
  file,
  catalog = LOCAL_PRODUCT_IMAGES,
  { crop = "center", signal, sampleFraming = false } = {},
) {
  checkAbort(signal);
  if (!Array.isArray(catalog) || !catalog.length)
    return { matches: [], reason: "no-match", method: "local-visual" };
  if (
    catalog.length > 1000 ||
    new Set(catalog.map((entry) => entry.id)).size !== catalog.length ||
    catalog.some((entry) => typeof entry.id !== "string" || !entry.id)
  ) {
    throw new Error("商品图片索引无效");
  }
  catalog.forEach(catalogUrl);
  const queryImage = await decodeImage(file, signal);
  const catalogImages = new Map();
  try {
    const query = describePixels(
      imageCanvas(queryImage, crop).context.getImageData(0, 0, DESCRIPTOR_SIZE, DESCRIPTOR_SIZE),
    );
    if (query.contrast < 0.025)
      return { matches: [], reason: "insufficient-detail", method: "local-visual" };
    const descriptors = [];
    for (const entry of catalog) {
      checkAbort(signal);
      const url = catalogUrl(entry);
      if (!catalogImages.has(url)) catalogImages.set(url, await loadCatalogImage(entry, signal));
      const image = catalogImages.get(url);
      const reference = entry.crop ?? "full";
      const region =
        sampleFraming && typeof crop === "object"
          ? referenceCropForSample(image.width, image.height, reference, crop)
          : reference;
      const { context } = imageCanvas(image, region);
      descriptors.push({
        id: entry.id,
        descriptor: describePixels(context.getImageData(0, 0, DESCRIPTOR_SIZE, DESCRIPTOR_SIZE)),
      });
    }
    return rankCatalog(query, descriptors, { signal });
  } finally {
    queryImage.close();
    for (const image of catalogImages.values()) image.close();
  }
}

export async function createCatalogSample(id, { signal } = {}) {
  checkAbort(signal);
  const entry = LOCAL_PRODUCT_IMAGES.find((product) => product.id === id);
  if (!entry) throw new Error("商品图片不存在");
  const image = await loadCatalogImage(entry, signal);
  try {
    const { canvas } = imageCanvas(image, entry.crop, 512);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    checkAbort(signal);
    if (!blob) throw new Error("无法创建商品示例图片");
    return blob;
  } finally {
    image.close();
  }
}
