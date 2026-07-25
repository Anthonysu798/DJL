#!/usr/bin/env bash
set -euo pipefail

version="${DJL_RELEASE_VERSION:?Set DJL_RELEASE_VERSION, for example 0.5.2}"
host="${DJL_RELEASE_HOST:?Set DJL_RELEASE_HOST to the SSH destination for the legacy VPS}"
key="${DJL_RELEASE_SSH_KEY:?Set DJL_RELEASE_SSH_KEY to the release SSH private-key path}"
update_url="${DJL_RELEASE_UPDATE_URL:-https://downloads.slcor.com/stable}"
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
host_platform="$(node -p 'process.platform')"

case "$host_platform" in
  darwin) release_platform=mac ;;
  win32) release_platform=windows ;;
  *)
    echo "DJL VPS releases must run on macOS or Windows; detected $host_platform." >&2
    exit 2
    ;;
esac

node --input-type=module --experimental-strip-types - "$repo_root" "$version" <<'NODE'
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
const [, , repositoryRoot, version] = process.argv;
const moduleUrl = pathToFileURL(
  resolve(repositoryRoot, "scripts/lib/public-desktop-release.ts"),
);
const { validatePublicDesktopReleaseVersion } = await import(moduleUrl.href);
validatePublicDesktopReleaseVersion(version);
NODE

[[ "$update_url" == "https://downloads.slcor.com/stable" ]] || {
  echo "Production releases must embed https://downloads.slcor.com/stable." >&2
  exit 2
}
[[ -r "$key" ]] || {
  echo "Release SSH key is not readable: $key" >&2
  exit 2
}
[[ -z "$(git -C "$repo_root" status --short --untracked-files=normal)" ]] || {
  echo "Manual releases require a completely clean worktree." >&2
  exit 1
}
[[ "$(git -C "$repo_root" rev-parse HEAD)" == "$(git -C "$repo_root" rev-parse origin/main)" ]] || {
  echo "Manual releases must run from the exact current origin/main commit." >&2
  exit 1
}
ssh -i "$key" -o BatchMode=yes "$host" \
  "test ! -e '/srv/djl-releases/releases/$version/$release_platform' &&
   test ! -L '/srv/djl-releases/releases/$version/$release_platform'" || {
    echo "VPS release $version/$release_platform already exists and will not be overwritten." >&2
    exit 1
  }

workspace="$(mktemp -d "${TMPDIR:-/tmp}/djl-vps-release-${version}-${release_platform}.XXXXXX")"
trap 'rm -rf "$workspace"' EXIT
prepared_dir="$workspace/prepared"
mkdir -p "$prepared_dir"

bun install --frozen-lockfile --ignore-scripts
node scripts/update-release-package-versions.ts "$version"

write_sha256sums() {
  node --input-type=module - "$prepared_dir" <<'NODE'
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
const [, , directory] = process.argv;
const names = readdirSync(directory)
  .filter((name) => name !== "SHA256SUMS")
  .sort();
const lines = names.map((name) => {
  const digest = createHash("sha256")
    .update(readFileSync(resolve(directory, name)))
    .digest("hex");
  return `${digest}  ${name}`;
});
writeFileSync(resolve(directory, "SHA256SUMS"), `${lines.join("\n")}\n`);
NODE
}

if [[ "$release_platform" == "mac" ]]; then
  apple_key="${APPLE_API_KEY:?Set APPLE_API_KEY to the App Store Connect API-key path}"
  apple_key_id="${APPLE_API_KEY_ID:?Set APPLE_API_KEY_ID}"
  apple_issuer="${APPLE_API_ISSUER:?Set APPLE_API_ISSUER}"
  [[ -r "$apple_key" ]] || {
    echo "App Store Connect API key is not readable: $apple_key" >&2
    exit 2
  }
  security find-identity -v -p codesigning |
    grep -Fq 'Developer ID Application: ANTHONY SU (U76N9JSK4M)' || {
      echo "The DJL Developer ID Application identity is unavailable in Keychain." >&2
      exit 1
    }

  build_mac() {
    local arch="$1"
    local output="$workspace/mac-$arch"
    mkdir "$output" || return 1
    if ! APPLE_API_KEY="$apple_key" \
      APPLE_API_KEY_ID="$apple_key_id" \
      APPLE_API_ISSUER="$apple_issuer" \
      CSC_IDENTITY_AUTO_DISCOVERY=true \
      DJL_DESKTOP_UPDATE_URL="$update_url" \
        bun run dist:desktop:artifact -- \
          --platform mac --target dmg --arch "$arch" \
          --build-version "$version" --output-dir "$output" --signed --verbose; then
      echo "macOS $arch packaging failed before asset collection." >&2
      return 1
    fi

    cp "$output/DJL-$version-$arch.dmg" "$prepared_dir/" || return 1
    cp "$output/DJL-$version-$arch.dmg.blockmap" "$prepared_dir/" || return 1
    cp "$output/DJL-$version-$arch.zip" "$prepared_dir/" || return 1
    cp "$output/latest-mac.yml" "$workspace/latest-mac-$arch.yml" || return 1
  }

  build_mac arm64
  build_mac x64

  node scripts/merge-mac-update-manifests.ts \
    "$workspace/latest-mac-arm64.yml" \
    "$workspace/latest-mac-x64.yml" \
    "$prepared_dir/latest-mac.yml"
  cp "$prepared_dir/latest-mac.yml" "$prepared_dir/djl-mac.yml"
  cp "$prepared_dir/latest-mac.yml" "$prepared_dir/synara-mac.yml"
  write_sha256sums

  for arch in arm64 x64; do
    dmg="$prepared_dir/DJL-$version-$arch.dmg"
    mount_point="$workspace/mount-$arch"
    mkdir "$mount_point"
    xcrun stapler validate "$dmg"
    spctl --assess --type open --context context:primary-signature --verbose=4 "$dmg"
    (
      cleanup() {
        hdiutil detach "$mount_point" -quiet || true
      }
      trap cleanup EXIT
      hdiutil attach "$dmg" -nobrowse -readonly -mountpoint "$mount_point" -quiet
      app="$mount_point/DJL.app"
      codesign --verify --deep --strict --verbose=2 "$app"
      signature="$(codesign --display --verbose=4 "$app" 2>&1)"
      grep -F "Authority=Developer ID Application: ANTHONY SU (U76N9JSK4M)" <<<"$signature"
      grep -F "TeamIdentifier=U76N9JSK4M" <<<"$signature"
      spctl --assess --type execute --verbose=4 "$app"
      grep -F "url: $update_url" "$app/Contents/Resources/app-update.yml"
    )
  done
else
  output="$workspace/windows-x64"
  mkdir "$output"
  env -u APPLE_API_KEY -u APPLE_API_KEY_ID -u APPLE_API_ISSUER \
    CSC_IDENTITY_AUTO_DISCOVERY=false \
    DJL_DESKTOP_UPDATE_URL="$update_url" \
    bun run dist:desktop:artifact -- \
      --platform win --target nsis --arch x64 \
      --build-version "$version" --output-dir "$output" --verbose
  cp "$output/DJL-$version-x64.exe" "$prepared_dir/"
  cp "$output/DJL-$version-x64.exe.blockmap" "$prepared_dir/"
  cp "$output/latest.yml" "$prepared_dir/"
  cp "$prepared_dir/latest.yml" "$prepared_dir/djl.yml"
  cp "$prepared_dir/latest.yml" "$prepared_dir/synara.yml"
  write_sha256sums
fi

DJL_RELEASE_VERSION="$version" \
DJL_RELEASE_PLATFORM="$release_platform" \
DJL_RELEASE_ASSET_DIR="$prepared_dir" \
DJL_RELEASE_HOST="$host" \
DJL_RELEASE_SSH_KEY="$key" \
  bash scripts/publish-desktop-release-to-vps.sh
