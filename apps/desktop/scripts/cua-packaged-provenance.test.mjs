import { describe, expect, it } from "vitest";
import { normalizeSignatureAllocation } from "./cua-packaged-provenance.mjs";
function fixture(slack = 0) {
  const bytes = Buffer.alloc(128);
  bytes.writeUInt32LE(0xfeedfacf, 0);
  bytes.writeUInt32LE(0x0100000c, 4);
  bytes.writeUInt32LE(1, 16);
  bytes.writeUInt32LE(72, 20);
  bytes.writeUInt32LE(0x19, 32);
  bytes.writeUInt32LE(72, 36);
  bytes.write("__LINKEDIT", 40);
  bytes.writeBigUInt64LE(BigInt(16384 + slack), 64);
  bytes.writeBigUInt64LE(8192n, 80);
  return bytes;
}
describe("Cua signing provenance", () => {
  it("normalizes bounded signing allocation without hiding executable changes", () => {
    expect(normalizeSignatureAllocation(fixture(16384))).toEqual(
      normalizeSignatureAllocation(fixture()),
    );
    const altered = fixture();
    altered[120] = 1;
    expect(normalizeSignatureAllocation(altered)).not.toEqual(
      normalizeSignatureAllocation(fixture()),
    );
  });
  it("refuses malformed commands and unbounded allocation changes", () => {
    const malformed = fixture();
    malformed.writeUInt32LE(0xffff, 36);
    expect(() => normalizeSignatureAllocation(malformed)).toThrow();
    expect(() => normalizeSignatureAllocation(fixture(2 * 1024 * 1024))).toThrow();
  });
});
