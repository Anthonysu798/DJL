import { describe, expect, it } from "vitest";

import { MAX_ATTACHMENTS, MAX_FILE_BYTES, resolveMimeType, validateFile } from "./attachments";

describe("attachment validation", () => {
  it("accepts images and supported documents", () => {
    expect(validateFile({ name: "a.png", size: 10, type: "image/png" }, 0)).toBeNull();
    expect(validateFile({ name: "r.pdf", size: 10, type: "application/pdf" }, 0)).toBeNull();
  });

  it("infers the type from the extension when the browser leaves it empty", () => {
    expect(resolveMimeType({ name: "notes.md", size: 1, type: "" })).toBe("text/markdown");
    expect(validateFile({ name: "data.csv", size: 1, type: "" }, 0)).toBeNull();
  });

  it("rejects unsupported types, empty and oversized files, and too many attachments", () => {
    expect(validateFile({ name: "run.exe", size: 5, type: "application/x-msdownload" }, 0)).toEqual(
      {
        kind: "unsupported_type",
      },
    );
    expect(validateFile({ name: "a.png", size: 0, type: "image/png" }, 0)).toEqual({
      kind: "empty",
    });
    expect(
      validateFile({ name: "big.png", size: MAX_FILE_BYTES + 1, type: "image/png" }, 0),
    ).toEqual({ kind: "too_large", maxMb: 25 });
    expect(validateFile({ name: "a.png", size: 1, type: "image/png" }, MAX_ATTACHMENTS)).toEqual({
      kind: "too_many",
      max: MAX_ATTACHMENTS,
    });
  });
});
