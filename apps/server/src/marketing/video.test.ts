import { describe, expect, it } from "vitest";
import { validateTimeline, buildVideoArguments } from "./video";
describe("video timelines", () => {
  const source = { path: "/tmp/source.mp4", duration: 20, hasAudio: true };
  it("rejects trims outside the source and non-finite speed", () => {
    expect(() => validateTimeline([{ ...source, start: 19, end: 25, speed: 1 }])).toThrow();
    expect(() => validateTimeline([{ ...source, start: 1, end: 5, speed: NaN }])).toThrow();
  });
  it("builds deterministic reordered trim exports without a shell command", () => {
    const clips = [
      { ...source, start: 5, end: 10, speed: 2 },
      { ...source, start: 0, end: 3, speed: 1 },
    ];
    const args = buildVideoArguments(clips, "/tmp/out.mp4", 720, 1280);
    expect(args).toContain("/tmp/source.mp4");
    expect(args.join(" ")).toContain("concat=n=2:v=1:a=1");
    expect(args.join(" ")).toContain("atempo=2");
    expect(args.at(-1)).toBe("/tmp/out.mp4");
  });
});
