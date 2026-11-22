import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import { chmod, copyFile, lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  DESKTOP_MEDIA_MANIFEST,
  DESKTOP_MEDIA_MANIFEST_VERSION,
  type DesktopMediaTarget,
  type MediaDownload,
} from "./desktop-media-manifest.ts";

const exec = promisify(execFile);
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const command = (file: string, args: string[], cwd?: string) =>
  exec(file, args, { cwd, timeout: 60000, maxBuffer: 128 * 1024 * 1024, encoding: "buffer" });
export function resolveDesktopMediaTargets(platform: string, arch: string): DesktopMediaTarget[] {
  if (platform === "linux") return [];
  if (platform === "mac" && arch === "universal") return ["darwin-arm64", "darwin-x64"];
  const target = `${platform === "mac" ? "darwin" : platform === "win" ? "win32" : platform}-${arch}`;
  if (!Object.hasOwn(DESKTOP_MEDIA_MANIFEST, target))
    throw new Error(`No verified media binary distribution for ${target}.`);
  return [target as DesktopMediaTarget];
}

export function verifyMediaDigest(bytes: Uint8Array, expected: string, label: string) {
  if (hash(bytes) !== expected)
    throw new Error(`Media integrity mismatch: ${label}. Refusing to stage changed vendor bytes.`);
}
export function verifyMediaArchitecture(bytes: Buffer, target: DesktopMediaTarget) {
  const macCpu = target.endsWith("arm64") ? 0x0100000c : 0x01000007;
  const valid = target.startsWith("darwin")
    ? bytes.length >= 8 && bytes.readUInt32LE(0) === 0xfeedfacf && bytes.readUInt32LE(4) === macCpu
    : bytes.length >= 64 &&
      bytes.toString("ascii", 0, 2) === "MZ" &&
      (() => {
        const offset = bytes.readUInt32LE(60);
        return (
          offset + 6 <= bytes.length &&
          bytes.readUInt32LE(offset) === 0x00004550 &&
          bytes.readUInt16LE(offset + 4) === 0x8664
        );
      })();
  if (!valid)
    throw new Error(
      `Media executable is not ${target}; filename and parent directory are not architecture evidence.`,
    );
}
export function verifyRedistributableMedia(
  version: string,
  license: string,
  expectedVersion: string,
) {
  if (!version.includes(`version ${expectedVersion} `))
    throw new Error("Unexpected media runtime version.");
  if (
    /--enable-nonfree|not (?:legally )?redistributable|nonfree parts/i.test(
      `${version}\n${license}`,
    )
  )
    throw new Error("Media binary is nonfree and cannot be redistributed.");
  if (!/GNU General Public License/i.test(license))
    throw new Error("Media binary did not report the expected GPL license.");
}
async function download(asset: MediaDownload, cacheDir: string) {
  await mkdir(cacheDir, { recursive: true });
  const cached = path.join(cacheDir, asset.sha256);
  let bytes: Buffer | undefined;
  try {
    bytes = await readFile(cached);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (bytes) {
    verifyMediaDigest(bytes, asset.sha256, asset.url);
    return cached;
  }
  const response = await fetch(asset.url, { signal: AbortSignal.timeout(120000) });
  if (!response.ok)
    throw new Error(`Pinned media download failed (HTTP ${response.status}): ${asset.url}`);
  bytes = Buffer.from(await response.arrayBuffer());
  verifyMediaDigest(bytes, asset.sha256, asset.url);
  // A partial fetch never becomes a valid cache entry.
  await writeFile(cached, bytes, { mode: 0o600 });
  return cached;
}
function fileName(target: DesktopMediaTarget, name: "ffmpeg" | "ffprobe") {
  return `${name}${target.startsWith("win32") ? ".exe" : ""}`;
}

export function findPackagedMediaRoots(distDir: string, productName = "DJL") {
  return readdirSync(distDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => [
      path.join(distDir, entry.name, "resources", "media"),
      path.join(distDir, entry.name, `${productName}.app`, "Contents", "Resources", "media"),
    ])
    .filter((candidate) => existsSync(candidate));
}

export async function verifyDesktopMedia(
  mediaRoot: string,
  target: DesktopMediaTarget,
  packaged = false,
) {
  const manifest = DESKTOP_MEDIA_MANIFEST[target];
  const dir = path.join(mediaRoot, target);
  const receipt = JSON.parse(await readFile(path.join(dir, "provenance.json"), "utf8"));
  if (
    receipt.schemaVersion !== DESKTOP_MEDIA_MANIFEST_VERSION ||
    receipt.target !== target ||
    JSON.stringify(receipt.manifest) !== JSON.stringify(manifest)
  )
    throw new Error("Media provenance does not match the pinned staging manifest.");
  verifyMediaDigest(
    await readFile(path.join(dir, "LICENSE.GPLv3.txt")),
    manifest.license.payloadSha256 ?? manifest.license.sha256,
    "license notice",
  );
  verifyMediaDigest(
    await readFile(path.join(dir, "BUILD-INFO.txt")),
    manifest.buildInfo.payloadSha256 ?? manifest.buildInfo.sha256,
    "vendor build information",
  );
  const sourceNotice = await readFile(path.join(dir, "SOURCE.txt"), "utf8");
  if (!sourceNotice.includes(manifest.source) || !sourceNotice.includes(manifest.buildSource))
    throw new Error("Bundled media source/build references are missing.");
  for (const name of ["ffmpeg", "ffprobe"] as const) {
    const file = path.join(dir, fileName(target, name));
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink())
      throw new Error("Media executables must be regular files.");
    const bytes = await readFile(file);
    verifyMediaArchitecture(bytes, target);
    // Developer ID/Authenticode signing changes executable bytes. Vendor integrity was checked before signing;
    // packaged builds are protected by the outer signed installer/app plus the native behavior smoke below.
    if (!packaged)
      verifyMediaDigest(bytes, manifest[name].payloadSha256 ?? manifest[name].sha256, name);
  }
}

export async function smokeDesktopMedia(mediaRoot: string, target: DesktopMediaTarget) {
  if (target !== `${process.platform}-${process.arch}`)
    throw new Error(
      `Native media smoke requires a matching ${target} runner, current ${process.platform}-${process.arch}.`,
    );
  const dir = path.join(mediaRoot, target);
  const ffmpeg = path.join(dir, fileName(target, "ffmpeg")),
    ffprobe = path.join(dir, fileName(target, "ffprobe"));
  const manifest = DESKTOP_MEDIA_MANIFEST[target];
  for (const binary of [ffmpeg, ffprobe]) {
    const version = (await command(binary, ["-version"])).stdout.toString();
    const license = (await command(binary, ["-L"])).stdout.toString();
    verifyRedistributableMedia(version, license, manifest.version);
    if (process.platform === "darwin") {
      const links = (await command("otool", ["-L", binary])).stdout
        .toString()
        .split("\n")
        .slice(1)
        .map((line) => line.trim())
        .filter(Boolean);
      if (
        links.some((line) => !line.startsWith("/usr/lib/") && !line.startsWith("/System/Library/"))
      )
        throw new Error(
          "Media executable depends on libraries outside the macOS system; refusing a machine-specific bundle.",
        );
    }
  }
  const temp = await mkdtemp(path.join(tmpdir(), "djl-media-smoke-"));
  try {
    const output = path.join(temp, "smoke.mp4");
    const cover = path.join(temp, "cover.png");
    await command(ffmpeg, [
      "-hide_banner",
      "-loglevel",
      "error",
      "-nostdin",
      "-y",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=64x64:rate=10:duration=0.4",
      "-f",
      "lavfi",
      "-i",
      "color=c=white:s=16x16:r=10:d=0.4",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=0.4",
      "-filter_complex",
      "[0:v]crop=32:64,scale=36:64,setsar=1,fps=10[v];[v][1:v]overlay=0:0:enable='gte(t,0)*lt(t,0.2)'[out]",
      "-map",
      "[out]",
      "-map",
      "2:a",
      "-t",
      "0.4",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-movflags",
      "+faststart",
      output,
    ]);
    const probe = JSON.parse(
      (
        await command(ffprobe, [
          "-v",
          "error",
          "-show_streams",
          "-show_format",
          "-of",
          "json",
          output,
        ])
      ).stdout.toString(),
    ) as {
      streams: { codec_type: string; codec_name: string; width: number; height: number }[];
      format: { duration: string };
    };
    if (
      !probe.streams.some(
        (stream) => stream.codec_name === "h264" && stream.width === 36 && stream.height === 64,
      ) ||
      !probe.streams.some((stream) => stream.codec_name === "aac") ||
      Math.abs(Number(probe.format.duration) - 0.4) > 0.15
    )
      throw new Error(
        "Bundled media encode/probe smoke produced unexpected codecs, dimensions or duration.",
      );
    await command(ffmpeg, ["-v", "error", "-nostdin", "-xerror", "-i", output, "-f", "null", "-"]);
    await command(ffmpeg, ["-v", "error", "-nostdin", "-i", output, "-frames:v", "1", cover]);
    if (!(await readFile(cover)).subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")))
      throw new Error("Bundled media cover generation did not produce a PNG.");
    return {
      target,
      version: manifest.version,
      width: 36,
      height: 64,
      duration: Number(probe.format.duration),
      audio: "aac",
      video: "h264",
    };
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

export async function stageDesktopMedia(input: {
  platform: string;
  arch: string;
  mediaRoot: string;
  cacheDir: string;
}) {
  const targets = resolveDesktopMediaTargets(input.platform, input.arch);
  for (const target of targets) {
    const manifest = DESKTOP_MEDIA_MANIFEST[target],
      dir = path.join(input.mediaRoot, target);
    await mkdir(dir, { recursive: true });
    for (const name of ["ffmpeg", "ffprobe", "license", "buildInfo"] as const) {
      const asset = manifest[name];
      const cached = await download(asset, input.cacheDir);
      const output = path.join(
        dir,
        name === "license"
          ? "LICENSE.GPLv3.txt"
          : name === "buildInfo"
            ? "BUILD-INFO.txt"
            : fileName(target, name),
      );
      if (asset.archiveEntry) {
        // Extract one known entry to stdout; vendor archives cannot write paths or symlinks into the stage.
        // Pass the archive by name from its folder: GNU tar reads "D:\..." as a remote host.
        // On Windows use the system bsdtar: Git's GNU tar on PATH cannot read the zip download.
        const tar =
          process.platform === "win32"
            ? path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe")
            : "tar";
        const bytes = (
          await command(
            tar,
            ["-xOf", path.basename(cached), asset.archiveEntry],
            path.dirname(cached),
          )
        ).stdout;
        verifyMediaDigest(bytes, asset.payloadSha256!, asset.archiveEntry);
        await writeFile(output, bytes);
      } else await copyFile(cached, output);
      if (name === "ffmpeg" || name === "ffprobe") await chmod(output, 0o755);
    }
    await writeFile(
      path.join(dir, "provenance.json"),
      `${JSON.stringify({ schemaVersion: DESKTOP_MEDIA_MANIFEST_VERSION, target, manifest }, null, 2)}\n`,
    );
    await writeFile(
      path.join(dir, "SOURCE.txt"),
      `FFmpeg and FFprobe are separate command-line programs, distributed under GPLv3 or later. DJL does not modify their program code.\nVendor: ${manifest.vendor}\nCorresponding FFmpeg source: ${manifest.source}\nBuild scripts and dependency sources: ${manifest.buildSource}\nSee BUILD-INFO.txt for linked libraries and build options and LICENSE.GPLv3.txt for license terms.\nExecutable signatures may be replaced during app signing.\n`,
    );
    await verifyDesktopMedia(input.mediaRoot, target);
    if (target === `${process.platform}-${process.arch}`)
      await smokeDesktopMedia(input.mediaRoot, target);
  }
  return targets;
}
