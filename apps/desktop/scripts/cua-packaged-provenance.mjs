import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { assertCuaArtifactProvenance } from "./cua-artifact-provenance.mjs";

/** codesign leaves its former allocation in __LINKEDIT.vmsize after stripping.
 * Normalize only that bounded signature slack; retain every executable/data byte,
 * other load command and segment mapping in the fingerprint. */
export function normalizeSignatureAllocation(input) {
  const bytes = Buffer.from(input);
  if (bytes.length < 32 || bytes.readUInt32LE(0) !== 0xfeedfacf)
    throw new Error("Expected a thin 64-bit Mach-O executable.");
  const page = bytes.readUInt32LE(4) === 0x0100000c ? 16384n : 4096n;
  const count = bytes.readUInt32LE(16);
  const end = 32 + bytes.readUInt32LE(20);
  if (end > bytes.length) throw new Error("Invalid Mach-O load commands.");
  let offset = 32;
  for (let index = 0; index < count; index++) {
    if (offset + 8 > end) throw new Error("Invalid Mach-O load command.");
    const command = bytes.readUInt32LE(offset);
    const size = bytes.readUInt32LE(offset + 4);
    if (size < 8 || offset + size > end) throw new Error("Invalid Mach-O load command size.");
    if (
      command === 0x19 &&
      size >= 72 &&
      bytes.toString("ascii", offset + 8, offset + 24).replace(/\0+$/, "") === "__LINKEDIT"
    ) {
      const vmSize = bytes.readBigUInt64LE(offset + 32);
      const fileSize = bytes.readBigUInt64LE(offset + 48);
      if (vmSize < fileSize || vmSize > fileSize + 1024n * 1024n)
        throw new Error("Unexpected Mach-O signature allocation.");
      bytes.writeBigUInt64LE(((fileSize + page - 1n) / page) * page, offset + 32);
    }
    offset += size;
  }
  if (offset !== end) throw new Error("Invalid Mach-O load command boundary.");
  return bytes;
}

export async function signatureIndependentMachODigest(binary) {
  const architectures = execFileSync("/usr/bin/lipo", ["-archs", binary], { encoding: "utf8" })
    .trim()
    .split(/\s+/)
    .sort();
  const directory = await mkdtemp(join(tmpdir(), "djl-cua-code-"));
  const hash = createHash("sha256");
  try {
    for (const arch of architectures) {
      const slice = join(directory, arch);
      if (architectures.length === 1) await copyFile(binary, slice);
      else execFileSync("/usr/bin/lipo", [binary, "-thin", arch, "-output", slice]);
      execFileSync("/usr/bin/codesign", ["--remove-signature", slice], { stdio: "pipe" });
      hash.update(`${arch}\0`);
      hash.update(normalizeSignatureAllocation(await readFile(slice)));
    }
    return hash.digest("hex");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function verifyPackagedCua(directory, release, architectures) {
  const binary = join(directory, "cua-driver");
  const provenance = JSON.parse(await readFile(join(directory, "provenance.json"), "utf8"));
  assertCuaArtifactProvenance({
    provenance,
    release,
    platform: "darwin",
    architectures,
    binarySha256: provenance.binarySha256,
  });
  execFileSync("/usr/bin/codesign", ["--verify", "--strict", binary], { stdio: "pipe" });
  const actualArchitectures = execFileSync("/usr/bin/lipo", ["-archs", binary], {
    encoding: "utf8",
  })
    .trim()
    .split(/\s+/);
  if (
    actualArchitectures.length !== architectures.length ||
    architectures.some((arch) => !actualArchitectures.includes(arch === "x64" ? "x86_64" : arch))
  )
    throw new Error("Packaged Cua architecture mismatch.");
  if (
    !/^[0-9a-f]{64}$/.test(provenance.codeSha256 ?? "") ||
    (await signatureIndependentMachODigest(binary)) !== provenance.codeSha256
  )
    throw new Error("Packaged Cua executable code differs from the staged pinned artifact.");
  return {
    codeSha256: provenance.codeSha256,
    binarySha256: createHash("sha256")
      .update(await readFile(binary))
      .digest("hex"),
  };
}
