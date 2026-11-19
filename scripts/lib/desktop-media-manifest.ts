/** Vendor downloads are immutable by content hash. Never use a latest/redirect URL here. */
export const DESKTOP_MEDIA_MANIFEST_VERSION = 1;
export type DesktopMediaTarget = "darwin-arm64" | "darwin-x64" | "win32-x64";
export interface MediaDownload {
  readonly url: string;
  readonly sha256: string;
  readonly payloadSha256?: string;
  readonly archiveEntry?: string;
}
export interface DesktopMediaManifest {
  readonly version: string;
  readonly vendor: string;
  readonly source: string;
  readonly buildSource: string;
  readonly license: MediaDownload;
  readonly buildInfo: MediaDownload;
  readonly ffmpeg: MediaDownload;
  readonly ffprobe: MediaDownload;
}
const gpl3 = {
  url: "https://raw.githubusercontent.com/FFmpeg/FFmpeg/n9.0.2/COPYING.GPLv3",
  sha256: "8ceb4b9ee5adedde47b31e975c1d90c73ad27b6b165a1dcd80c7c545eb65b903",
};
const arm = "https://ffmpeg.martin-riedl.de/download/macos/arm64/1789931890_9.0.2";
const intel = "https://ffmpeg.martin-riedl.de/download/macos/amd64/1789931006_9.0.2";
const windows =
  "https://github.com/GyanD/codexffmpeg/releases/download/9.0.2/ffmpeg-9.0.2-essentials_build.zip";
const windowsArchiveSha256 = "60f467265b1e312373dbcd92200c2618a74850f98d3d078e94296bb3fa2047ba";
const mac = {
  version: "9.0.2-https://www.martin-riedl.de",
  vendor: "Martin Riedl",
  source: "https://github.com/FFmpeg/FFmpeg/tree/n9.0.2",
  buildSource: "https://git.martin-riedl.de/ffmpeg/build-script",
  license: gpl3,
};
export const DESKTOP_MEDIA_MANIFEST: Record<DesktopMediaTarget, DesktopMediaManifest> = {
  "darwin-arm64": {
    ...mac,
    buildInfo: {
      url: `${arm}/versions.txt`,
      sha256: "fc92572e752e09b20e7ff28d64fb7096f7bc1a0d589b2e40f17ac91b7fd0ca61",
    },
    ffmpeg: {
      url: `${arm}/ffmpeg.zip`,
      sha256: "c8ed4c4e6978a03c485edbfe4e0a5dc2380f8a30bba5150531b31b094492d924",
      payloadSha256: "2e11c6f90993cdb79fff84d3f90044d28316b310e75b3e030cfc9a54f2c9d384",
      archiveEntry: "ffmpeg",
    },
    ffprobe: {
      url: `${arm}/ffprobe.zip`,
      sha256: "fcbe839537485eaee7a7a8bc5cbc0f90d53617e80943e8a5b2e31cb851197ea6",
      payloadSha256: "2738aa46a7f9acbc8ab09a6715554c90f7de603171ac403726765685df6a0059",
      archiveEntry: "ffprobe",
    },
  },
  "darwin-x64": {
    ...mac,
    buildInfo: {
      url: `${intel}/versions.txt`,
      sha256: "64347e66bb487d52c6a8a43180028dc2a4d1dc0519ec81233d55e2bd59ebd98e",
    },
    ffmpeg: {
      url: `${intel}/ffmpeg.zip`,
      sha256: "7c6b4125b191cbf773832dc51f424cf2b6bb7da43007d1e066f95909e47cacd4",
      payloadSha256: "b25689cf2211c0582d317e849912769a1f1c93904fe102c485b5364a425633d1",
      archiveEntry: "ffmpeg",
    },
    ffprobe: {
      url: `${intel}/ffprobe.zip`,
      sha256: "2322438ed2f6319a691291b247d09c69dcaa3a982460d1f269a7e1af335cfdfd",
      payloadSha256: "b5df9964b0c2048318fafedcd4e3bbafbc561033cee77de8da1840685d8a9d0d",
      archiveEntry: "ffprobe",
    },
  },
  "win32-x64": {
    version: "9.0.2-essentials_build-www.gyan.dev",
    vendor: "Gyan Doshi, official GyanD/codexffmpeg release 9.0.2",
    source: "https://github.com/FFmpeg/FFmpeg/commit/946fcce07b",
    buildSource: "https://www.gyan.dev/ffmpeg/builds/",
    license: gpl3,
    buildInfo: {
      url: windows,
      sha256: windowsArchiveSha256,
      archiveEntry: "ffmpeg-9.0.2-essentials_build/README.txt",
      payloadSha256: "0342de6bb39dd421cbec2c00d89ad274b640d75ad3f2cab09ffd647ce2d8f949",
    },
    ffmpeg: {
      url: windows,
      sha256: windowsArchiveSha256,
      archiveEntry: "ffmpeg-9.0.2-essentials_build/bin/ffmpeg.exe",
      payloadSha256: "3256173f3f8bffd7df12227c68adf68025edb1832273a9530688a7bb1ed8edec",
    },
    ffprobe: {
      url: windows,
      sha256: windowsArchiveSha256,
      archiveEntry: "ffmpeg-9.0.2-essentials_build/bin/ffprobe.exe",
      payloadSha256: "f0d36ecbbdd3bcfac3efa078c96c7271c2e68b3810595552ac3b7f17e9a65c52",
    },
  },
};
