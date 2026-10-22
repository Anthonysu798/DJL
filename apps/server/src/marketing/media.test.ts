import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { inspectImage, renderImage } from "./media";
import { defaultImageRecipe } from "@synara/contracts";
describe("non-destructive image processing", () => {
  it("rejects a disguised file and exports a real resized PNG without changing the original", async () => {
    await expect(inspectImage(Buffer.from("not an image"))).rejects.toThrow();
    const original = await sharp({
      create: { width: 40, height: 20, channels: 4, background: "#cc884480" },
    })
      .png()
      .toBuffer();
    const unchanged = Buffer.from(original);
    const result = await renderImage(original, {
      ...defaultImageRecipe,
      width: 20,
      height: 10,
      exposure: 1,
    });
    const metadata = await sharp(result).metadata();
    expect(metadata.width).toBe(20);
    expect(metadata.height).toBe(10);
    expect(metadata.hasAlpha).toBe(true);
    expect(original.equals(unchanged)).toBe(true);
  });
  it("rejects non-finite or unsafe export parameters", async () => {
    await expect(
      renderImage(Buffer.alloc(0), { ...defaultImageRecipe, width: 100000 }),
    ).rejects.toThrow("dimensions");
    await expect(
      renderImage(Buffer.alloc(0), { ...defaultImageRecipe, exposure: NaN }),
    ).rejects.toThrow("adjustment");
  });
});
