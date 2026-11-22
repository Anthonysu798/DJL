import { expect, it } from "vitest";
import {
  INSTAGRAM_GRID_SCRIPT,
  INSTAGRAM_POST_TIME_SCRIPT,
  gridCodes,
  madeByThisShare,
} from "./postLink";

const sent = "2026-11-20T18:03:47.000Z";
const after = (seconds: number) => new Date(Date.parse(sent) + seconds * 1000).toISOString();

it("accepts only a post published when this one was sent", () => {
  expect(madeByThisShare(after(4), sent)).toBe(true);
  expect(madeByThisShare(after(-60), sent)).toBe(true);
  // Somebody's older post, or one they made much later, is never passed off as this one.
  expect(madeByThisShare(after(-3600), sent)).toBe(false);
  expect(madeByThisShare(after(3600), sent)).toBe(false);
  for (const nothing of [null, undefined, 42, "soon", ""])
    expect(madeByThisShare(nothing, sent)).toBe(false);
});
it("keeps the first few plain post codes from the profile and nothing else", () => {
  expect(gridCodes(["DCabc_123-x", "x/../../evil", 42, "DCabc_123-x", "B2", "CODE_TWO22"])).toEqual(
    ["DCabc_123-x", "CODE_TWO22"],
  );
  expect(gridCodes(["AAAAA1", "AAAAA2", "AAAAA3", "AAAAA4", "AAAAA5"])).toHaveLength(4);
  for (const broken of [null, "nope", { length: 2 }]) expect(gridCodes(broken)).toEqual([]);
});
it("only reads what the page already shows, without calling Instagram itself", () => {
  for (const script of [INSTAGRAM_GRID_SCRIPT, INSTAGRAM_POST_TIME_SCRIPT]) {
    expect(script).not.toContain("fetch(");
    expect(script).not.toContain("XMLHttpRequest");
  }
});
