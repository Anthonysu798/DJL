/** Raster headers accepted by the private image store. SVG is never served as generated content. */
export function rasterMediaType(bytes: Uint8Array): string | null {
  if (bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v))
    return "image/png";
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
    return "image/jpeg";
  if (
    bytes.length >= 12 &&
    Buffer.from(bytes.subarray(0, 4)).toString() === "RIFF" &&
    Buffer.from(bytes.subarray(8, 12)).toString() === "WEBP"
  )
    return "image/webp";
  return null;
}

export function decodeRaster(base64: string, mediaType?: string): Uint8Array {
  if (
    base64.length > Math.ceil((16 * 1024 * 1024) / 3) * 4 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)
  )
    throw new Error("Invalid generated image.");
  const bytes = new Uint8Array(Buffer.from(base64, "base64"));
  const detected = rasterMediaType(bytes);
  if (!detected || (mediaType && detected !== mediaType))
    throw new Error("Unsupported generated image.");
  return bytes;
}
