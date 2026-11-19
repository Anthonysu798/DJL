/** Bounded ISO BMFF metadata inspection. This does not decode video frames. */
export function inspectMp4(bytes: Uint8Array): { durationSeconds: number; codec: string } | null {
  if (bytes.length < 16 || bytes.length > 25 * 1024 * 1024) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));
  let duration: number | undefined;
  const codecs: string[] = [];
  let boxes = 0;
  function walk(start: number, end: number, depth: number): void {
    if (depth > 6) throw new Error("depth");
    let at = start;
    while (at < end) {
      if (++boxes > 10000 || at + 8 > end) throw new Error("bounds");
      const size = view.getUint32(at);
      const type = text(at + 4);
      // Extended/zero sizes are deliberately unsupported, rather than guessed.
      if (size < 8 || at + size > end) throw new Error("size");
      const body = at + 8;
      const stop = at + size;
      if (type === "mvhd") {
        const version = bytes[body];
        const scaleAt = body + (version === 0 ? 12 : version === 1 ? 20 : 100000000);
        if (scaleAt + (version === 1 ? 12 : 8) > stop) throw new Error("header");
        const scale = view.getUint32(scaleAt);
        const count =
          version === 1 ? Number(view.getBigUint64(scaleAt + 4)) : view.getUint32(scaleAt + 4);
        if (!scale || !Number.isSafeInteger(count) || count <= 0) throw new Error("duration");
        duration = count / scale;
      }
      if (type === "stsd") {
        if (body + 8 > stop || view.getUint32(body + 4) !== 1 || body + 16 > stop)
          throw new Error("samples");
        const sampleSize = view.getUint32(body + 8);
        const codec = text(body + 12);
        if (sampleSize < 8 || body + 8 + sampleSize > stop) throw new Error("sample bounds");
        if (["avc1", "hvc1", "hev1"].includes(codec)) codecs.push(codec);
        else if (!["mp4a"].includes(codec)) throw new Error("codec");
      }
      if (["moov", "trak", "mdia", "minf", "stbl"].includes(type)) walk(body, stop, depth + 1);
      at = stop;
    }
  }
  try {
    walk(0, bytes.length, 0);
  } catch {
    return null;
  }
  return duration && Number.isFinite(duration) && codecs.length === 1
    ? { durationSeconds: duration, codec: codecs[0]! }
    : null;
}
