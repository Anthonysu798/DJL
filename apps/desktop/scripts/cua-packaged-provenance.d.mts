import type { Buffer } from "node:buffer";
interface CuaRelease {
  readonly version: string;
  readonly source: string;
  readonly nativeRevision: number;
  readonly rustVersion: string;
  readonly patchSha256: string;
  readonly linuxBrowserPatchSha256?: string;
  readonly linuxBrowserInputControl?: number;
}
export function normalizeSignatureAllocation(input: Uint8Array): Buffer;
export function signatureIndependentMachODigest(binary: string): Promise<string>;
export function verifyPackagedCua(
  directory: string,
  release: CuaRelease,
  architectures: readonly string[],
): Promise<{ codeSha256: string; binarySha256: string }>;
