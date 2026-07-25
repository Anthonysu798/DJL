#!/usr/bin/env bash
set -euo pipefail

version="${DJL_RELEASE_VERSION:?Set DJL_RELEASE_VERSION, for example 0.5.2}"
platform="${DJL_RELEASE_PLATFORM:?Set DJL_RELEASE_PLATFORM to mac or windows}"
asset_dir="${DJL_RELEASE_ASSET_DIR:?Set DJL_RELEASE_ASSET_DIR to the prepared platform directory}"
host="${DJL_RELEASE_HOST:?Set DJL_RELEASE_HOST to the SSH destination for the legacy VPS}"
key="${DJL_RELEASE_SSH_KEY:?Set DJL_RELEASE_SSH_KEY to the release SSH private-key path}"
remote_root="${DJL_RELEASE_ROOT:-/srv/djl-releases}"
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
sync_script="$repo_root/scripts/vps/sync-download-aliases.sh"

case "$platform" in
  mac|windows) ;;
  *)
    echo "DJL_RELEASE_PLATFORM must be mac or windows." >&2
    exit 2
    ;;
esac

node --input-type=module --experimental-strip-types - \
  "$repo_root" "$version" "$platform" "$asset_dir" <<'NODE'
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [, , repositoryRoot, rawVersion, platform, assetDirectory] = process.argv;
const moduleUrl = pathToFileURL(
  resolve(repositoryRoot, "scripts/lib/public-desktop-release.ts"),
);
const { validatePublicDesktopReleaseVersion } = await import(moduleUrl.href);
const { version } = validatePublicDesktopReleaseVersion(rawVersion);
const expected =
  platform === "mac"
    ? [
        `DJL-${version}-arm64.dmg`,
        `DJL-${version}-arm64.dmg.blockmap`,
        `DJL-${version}-arm64.zip`,
        `DJL-${version}-x64.dmg`,
        `DJL-${version}-x64.dmg.blockmap`,
        `DJL-${version}-x64.zip`,
        "SHA256SUMS",
        "djl-mac.yml",
        "latest-mac.yml",
        "synara-mac.yml",
      ]
    : [
        `DJL-${version}-x64.exe`,
        `DJL-${version}-x64.exe.blockmap`,
        "SHA256SUMS",
        "djl.yml",
        "latest.yml",
        "synara.yml",
      ];
expected.sort();
const actual = readdirSync(assetDirectory, { withFileTypes: true })
  .map((entry) => {
    if (!entry.isFile()) {
      throw new Error(`Release directory contains a non-file entry: ${entry.name}`);
    }
    return entry.name;
  })
  .sort();
if (JSON.stringify(actual) !== JSON.stringify(expected)) {
  throw new Error(
    `Prepared ${platform} assets do not match the exact contract.\nExpected: ${expected.join(", ")}\nActual: ${actual.join(", ")}`,
  );
}

const sums = readFileSync(resolve(assetDirectory, "SHA256SUMS"), "utf8")
  .trim()
  .split("\n");
const expectedSumFiles = expected.filter((name) => name !== "SHA256SUMS").sort();
const actualSumFiles = [];
for (const line of sums) {
  const match = /^([0-9a-f]{64})  ([^/]+)$/.exec(line);
  if (!match) throw new Error(`Invalid SHA256SUMS line: ${line}`);
  const [, expectedDigest, name] = match;
  const digest = createHash("sha256")
    .update(readFileSync(resolve(assetDirectory, name)))
    .digest("hex");
  if (digest !== expectedDigest) throw new Error(`SHA-256 mismatch for ${name}`);
  actualSumFiles.push(name);
}
actualSumFiles.sort();
if (JSON.stringify(actualSumFiles) !== JSON.stringify(expectedSumFiles)) {
  throw new Error("SHA256SUMS does not cover every platform asset exactly once.");
}
NODE

[[ "$remote_root" == "/srv/djl-releases" ]] || {
  echo "DJL_RELEASE_ROOT must be /srv/djl-releases." >&2
  exit 2
}
[[ -d "$asset_dir" ]] || {
  echo "Release asset directory does not exist: $asset_dir" >&2
  exit 2
}
[[ -r "$key" ]] || {
  echo "Release SSH key is not readable: $key" >&2
  exit 2
}

if [[ "$platform" == "mac" ]]; then
  for manifest in latest-mac.yml djl-mac.yml synara-mac.yml; do
    grep -Fq "DJL-$version-arm64.zip" "$asset_dir/$manifest"
    grep -Fq "DJL-$version-x64.zip" "$asset_dir/$manifest"
  done
else
  for manifest in latest.yml djl.yml synara.yml; do
    grep -Fq "DJL-$version-x64.exe" "$asset_dir/$manifest"
  done
fi

if [[ "${DJL_RELEASE_VALIDATE_ONLY:-0}" == "1" ]]; then
  echo "Validated DJL $version ($platform) assets without uploading."
  exit 0
fi

release_id="${version}-${platform}-manual-$(date -u +%Y%m%dT%H%M%SZ)"
remote_stage="$remote_root/incoming/$release_id"
platform_archive="$remote_root/releases/$version/$platform"

ssh -i "$key" -o BatchMode=yes "$host" \
  "test ! -e '$platform_archive' &&
   test ! -L '$platform_archive' &&
   install -d -m 0755 '$remote_stage' '$remote_root/releases/$version' '$remote_root/channels'"
scp -i "$key" -o BatchMode=yes "$asset_dir"/* "$host:$remote_stage/"
scp -i "$key" -o BatchMode=yes "$sync_script" "$host:$remote_stage/.sync-download-aliases.sh"

ssh -i "$key" -o BatchMode=yes "$host" bash -s -- \
  "$remote_root" "$version" "$platform" "$release_id" <<'REMOTE_SCRIPT'
set -euo pipefail

root="$1"
version="$2"
platform="$3"
release_id="$4"
stage="$root/incoming/$release_id"
platform_archive="$root/releases/$version/$platform"
archive_candidate="$root/incoming/$release_id-verified"
channel_dir="$root/channels/stable-$release_id"
stable_link="$root/stable"

[[ "$root" == "/srv/djl-releases" ]] || {
  echo "Refusing an unexpected release root." >&2
  exit 2
}
[[ ! -e "$platform_archive" && ! -L "$platform_archive" ]] || {
  echo "Platform archive already exists and is immutable: $platform_archive" >&2
  exit 1
}
[[ -L "$stable_link" || -d "$stable_link" ]] || {
  echo "A last known-good stable channel is required." >&2
  exit 1
}

files=("$stage"/*)
(( ${#files[@]} > 0 )) && [[ -f "${files[0]}" ]]
trap 'rm -rf "$archive_candidate" "$channel_dir"' EXIT
install -d -m 0755 "$archive_candidate"
cp "${files[@]}" "$archive_candidate/"
rm -f "$archive_candidate/.sync-download-aliases.sh"
(
  cd "$archive_candidate"
  sha256sum -c SHA256SUMS
)

cp -a "$(readlink -f "$stable_link")" "$channel_dir"
if [[ "$platform" == "mac" ]]; then
  rm -f \
    "$channel_dir"/DJL-*-arm64.dmg \
    "$channel_dir"/DJL-*-arm64.dmg.blockmap \
    "$channel_dir"/DJL-*-arm64.zip \
    "$channel_dir"/DJL-*-x64.dmg \
    "$channel_dir"/DJL-*-x64.dmg.blockmap \
    "$channel_dir"/DJL-*-x64.zip \
    "$channel_dir"/latest-mac.yml \
    "$channel_dir"/djl-mac.yml \
    "$channel_dir"/synara-mac.yml \
    "$channel_dir"/current-mac.dmg \
    "$channel_dir"/current-mac-arm64.dmg \
    "$channel_dir"/current-mac-x64.dmg
else
  rm -f \
    "$channel_dir"/DJL-*-x64.exe \
    "$channel_dir"/DJL-*-x64.exe.blockmap \
    "$channel_dir"/latest.yml \
    "$channel_dir"/djl.yml \
    "$channel_dir"/synara.yml \
    "$channel_dir"/current-windows.exe
fi
rm -f "$channel_dir/SHA256SUMS"
cp "$archive_candidate"/* "$channel_dir/"
rm -f "$channel_dir/SHA256SUMS"
(
  cd "$channel_dir"
  find . -maxdepth 1 -type f ! -name SHA256SUMS -printf '%P\0' |
    LC_ALL=C sort -z |
    xargs -0 sha256sum > SHA256SUMS
)
DJL_RELEASE_ROOT="$root" bash "$stage/.sync-download-aliases.sh" "$channel_dir"

mv "$archive_candidate" "$platform_archive"
ln -s "$channel_dir" "$root/.stable-$release_id"
mv -Tf "$root/.stable-$release_id" "$stable_link"
trap - EXIT
rm -rf "$stage"
REMOTE_SCRIPT

echo "Published DJL $version ($platform) to the VPS stable channel."
echo "Platform archive: https://downloads.slcor.com/releases/$version/$platform/"
echo "Update channel:   https://downloads.slcor.com/stable/"
