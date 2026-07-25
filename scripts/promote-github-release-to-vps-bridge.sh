#!/usr/bin/env bash
set -euo pipefail

# One-time migration publisher. It promotes an already-verified GitHub desktop
# release to the legacy VPS feed so installed 0.5.0 clients can upgrade to a
# binary whose embedded updater points at Anthonysu798/DJL.

version="${DJL_RELEASE_VERSION:?Set DJL_RELEASE_VERSION, for example 0.5.1}"
asset_dir="${DJL_RELEASE_ASSET_DIR:?Set DJL_RELEASE_ASSET_DIR to the downloaded GitHub release directory}"
host="${DJL_RELEASE_HOST:?Set DJL_RELEASE_HOST to the SSH destination for the legacy VPS}"
key="${DJL_RELEASE_SSH_KEY:?Set DJL_RELEASE_SSH_KEY to the release SSH private-key path}"
remote_root="${DJL_RELEASE_ROOT:-/srv/djl-releases}"
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
sync_script="$repo_root/scripts/vps/sync-download-aliases.sh"

node --input-type=module --experimental-strip-types - "$repo_root" "$version" <<'NODE'
import { pathToFileURL } from "node:url";

const [, , repositoryRoot, version] = process.argv;
const moduleUrl = pathToFileURL(`${repositoryRoot}/scripts/lib/public-desktop-release.ts`);
const { validatePublicDesktopReleaseVersion } = await import(moduleUrl.href);
validatePublicDesktopReleaseVersion(version);
NODE
if [[ "$remote_root" != "/srv/djl-releases" ]]; then
  echo "DJL_RELEASE_ROOT must be /srv/djl-releases for this production publisher." >&2
  exit 2
fi
if [[ ! -d "$asset_dir" ]]; then
  echo "Release asset directory does not exist: $asset_dir" >&2
  exit 2
fi
if [[ ! -r "$key" ]]; then
  echo "Release SSH key is not readable: $key" >&2
  exit 2
fi

required_assets=(
  "DJL-$version-arm64.dmg"
  "DJL-$version-arm64.dmg.blockmap"
  "DJL-$version-arm64.zip"
  "DJL-$version-x64.dmg"
  "DJL-$version-x64.dmg.blockmap"
  "DJL-$version-x64.zip"
  "DJL-$version-x64.exe"
  "DJL-$version-x64.exe.blockmap"
  "latest-mac.yml"
  "latest.yml"
  "djl-mac.yml"
  "djl.yml"
  "SHA256SUMS"
)
for asset in "${required_assets[@]}"; do
  if [[ ! -f "$asset_dir/$asset" ]]; then
    echo "Bridge release is missing $asset_dir/$asset" >&2
    exit 1
  fi
done

actual_assets=()
while IFS= read -r asset; do actual_assets+=("$asset"); done < <(
  find "$asset_dir" -maxdepth 1 -type f -exec basename {} \; | sort
)
expected_assets=()
while IFS= read -r asset; do expected_assets+=("$asset"); done < <(
  printf '%s\n' "${required_assets[@]}" | sort
)
if [[ "${actual_assets[*]}" != "${expected_assets[*]}" ]]; then
  echo "Bridge directory must contain exactly the published release assets." >&2
  diff -u <(printf '%s\n' "${expected_assets[@]}") <(printf '%s\n' "${actual_assets[@]}") || true
  exit 1
fi

(
  cd "$asset_dir"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum -c SHA256SUMS
  else
    shasum -a 256 -c SHA256SUMS
  fi
)

for manifest in latest-mac.yml djl-mac.yml; do
  grep -Fq "DJL-$version-arm64.zip" "$asset_dir/$manifest" || {
    echo "$manifest does not reference the $version Apple Silicon update." >&2
    exit 1
  }
  grep -Fq "DJL-$version-x64.zip" "$asset_dir/$manifest" || {
    echo "$manifest does not reference the $version Intel update." >&2
    exit 1
  }
done
for manifest in latest.yml djl.yml; do
  grep -Fq "DJL-$version-x64.exe" "$asset_dir/$manifest" || {
    echo "$manifest does not reference the $version Windows update." >&2
    exit 1
  }
done

release_id="${version}-github-bridge-$(date -u +%Y%m%dT%H%M%SZ)"
remote_stage="$remote_root/incoming/$release_id"

ssh -i "$key" -o BatchMode=yes "$host" \
  "install -d -m 0755 '$remote_stage' '$remote_root/releases' '$remote_root/channels'"
scp -i "$key" -o BatchMode=yes "$asset_dir"/* "$host:$remote_stage/"
scp -i "$key" -o BatchMode=yes "$sync_script" "$host:$remote_stage/.sync-download-aliases.sh"

ssh -i "$key" -o BatchMode=yes "$host" bash -s -- \
  "$remote_root" "$version" "$release_id" <<'REMOTE_SCRIPT'
set -euo pipefail

root="$1"
version="$2"
release_id="$3"
stage="$root/incoming/$release_id"
release_dir="$root/releases/$version"
release_candidate="$root/incoming/$release_id-verified"
channel_dir="$root/channels/stable-$release_id"
stable_link="$root/stable"

[[ "$root" == "/srv/djl-releases" ]] || {
  echo "Refusing an unexpected release root." >&2
  exit 2
}

files=("$stage"/*)
(( ${#files[@]} > 0 )) && [[ -f "${files[0]}" ]]

if [[ -e "$release_dir" || -L "$release_dir" ]]; then
  echo "Version archive already exists and is immutable: $release_dir" >&2
  exit 1
fi
trap 'rm -rf "$release_candidate"' EXIT
install -d -m 0755 "$release_candidate"
cp "${files[@]}" "$release_candidate/"
(
  cd "$release_candidate"
  sha256sum -c SHA256SUMS
)
mv "$release_candidate" "$release_dir"

if [[ -L "$stable_link" ]]; then
  cp -a "$(readlink -f "$stable_link")" "$channel_dir"
elif [[ -d "$stable_link" ]]; then
  cp -a "$stable_link" "$channel_dir"
else
  install -d -m 0755 "$channel_dir"
fi
cp -f "$release_dir"/* "$channel_dir/"
DJL_RELEASE_ROOT="$root" bash "$stage/.sync-download-aliases.sh" "$channel_dir"

if [[ -d "$stable_link" && ! -L "$stable_link" ]]; then
  mv "$stable_link" "$root/channels/legacy-stable-$release_id"
fi
ln -s "$channel_dir" "$root/.stable-$release_id"
mv -Tf "$root/.stable-$release_id" "$stable_link"
rm -rf "$stage"
REMOTE_SCRIPT

echo "Promoted DJL $version GitHub release as the one-time VPS bridge."
echo "Version archive: https://downloads.slcor.com/releases/$version/"
echo "Legacy channel:  https://downloads.slcor.com/stable/"
