import { expect, it } from "vitest";
import { parseVideoSubtitles } from "./videoSubtitles";

it("imports SRT and WebVTT as plain source timeline cues", () => {
  expect(
    parseVideoSubtitles("1\r\n00:00:01,200 --> 00:00:02,300\r\nActual words\r\non two lines\r\n"),
  ).toEqual([{ start: 1.2, end: 2.3, text: "Actual words on two lines" }]);
  expect(
    parseVideoSubtitles("WEBVTT\n\ncue-one\n00:01.200 --> 00:02.300 align:center\nActual words"),
  ).toEqual([{ start: 1.2, end: 2.3, text: "Actual words" }]);
});

it("rejects markup, empty cues, overlaps, malformed times and oversized input", () => {
  for (const value of [
    "WEBVTT",
    "00:00:00,000 --> 00:00:01,000\n<b>Text</b>",
    "00:00:00,000 --> 00:00:01,000\n{\\pos(1,1)}",
    "00:00:00,000 --> 00:00:01,000\n",
    "00:99:00,000 --> 00:99:01,000\nText",
    "00:00:00,000 --> 00:00:02,000\nOne\n\n00:00:01,000 --> 00:00:03,000\nTwo",
    "x".repeat(256001),
  ])
    expect(() => parseVideoSubtitles(value)).toThrow();
});
