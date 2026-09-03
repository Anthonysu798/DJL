#!/usr/bin/env bash

set -euo pipefail

[[ "$#" -eq 3 ]] || {
  echo "Usage: scripts/mirror-public-desktop-release-to-oss.sh <version> <asset-directory> <upload-immutable|promote-stable>" >&2
  exit 64
}

version="$1"
asset_directory="$2"
phase="$3"
ossutil_bin="${OSSUTIL_BIN:-ossutil}"
repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"

[[ "$phase" == "upload-immutable" || "$phase" == "promote-stable" ]] || {
  echo "Mirror phase must be upload-immutable or promote-stable." >&2
  exit 64
}
for name in OSS_ACCESS_KEY_ID OSS_ACCESS_KEY_SECRET OSS_BUCKET OSS_ENDPOINT OSS_REGION; do
  [[ -n "${!name:-}" ]] || {
    echo "Missing required OSS setting: $name" >&2
    exit 65
  }
done
[[ -d "$asset_directory" ]] || {
  echo "Release asset directory does not exist: $asset_directory" >&2
  exit 66
}
command -v "$ossutil_bin" >/dev/null || {
  echo "ossutil executable not found: $ossutil_bin" >&2
  exit 67
}

expected_names=()
while IFS= read -r name; do
  expected_names+=("$name")
done < <(
  VERSION="$version" node --experimental-strip-types --input-type=module \
    - "$repository_root/scripts/lib/public-desktop-release.ts" <<'NODE'
  import { pathToFileURL } from "node:url";

  const modulePath = process.argv[2];
  const { publishedPublicDesktopReleaseAssetNames } = await import(pathToFileURL(modulePath).href);
  for (const name of publishedPublicDesktopReleaseAssetNames(process.env.VERSION)) {
    console.log(name);
  }
NODE
)
actual_names=()
while IFS= read -r name; do
  actual_names+=("$name")
done < <(find "$asset_directory" -maxdepth 1 -type f -exec basename {} \; | sort)

if ! diff -u <(printf '%s\n' "${expected_names[@]}") <(printf '%s\n' "${actual_names[@]}"); then
  echo "Release asset inventory does not match the canonical 13-file set." >&2
  exit 68
fi

(
  cd "$asset_directory"
  if command -v sha256sum >/dev/null; then
    sha256sum -c SHA256SUMS
  else
    shasum -a 256 -c SHA256SUMS
  fi
)

manifest_names=("djl-mac.yml" "djl.yml" "latest-mac.yml" "latest.yml")

upload_file() {
  local source_path="$1"
  local object_uri="$2"
  "$ossutil_bin" cp "$source_path" "$object_uri" --force
}

expected_inventory() {
  local prefix="$1"
  local directory="$2"
  shift 2
  local name size
  for name in "$@"; do
    size="$(wc -c < "$directory/$name" | tr -d ' ')"
    printf '%s oss://%s/%s/%s\n' "$size" "$OSS_BUCKET" "$prefix" "$name"
  done | sort -k2
}

remote_inventory() {
  local prefix="$1"
  "$ossutil_bin" ls "oss://$OSS_BUCKET/$prefix/" --recursive \
    | awk '$1 ~ /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/ { print $5, $8 }' \
    | sort -k2
}

immutable_prefix="releases/$version"
if [[ "$phase" == "upload-immutable" ]]; then
  for name in "${expected_names[@]}"; do
    upload_file "$asset_directory/$name" "oss://$OSS_BUCKET/$immutable_prefix/$name"
  done
fi
if ! diff -u \
  <(expected_inventory "$immutable_prefix" "$asset_directory" "${expected_names[@]}") \
  <(remote_inventory "$immutable_prefix"); then
  echo "Remote OSS inventory does not match the verified release at $immutable_prefix/." >&2
  exit 69
fi

if [[ "$phase" == "upload-immutable" ]]; then
  echo "Mirrored DJL $version to oss://$OSS_BUCKET/$immutable_prefix/."
  exit 0
fi

stable_manifest_directory="$(mktemp -d)"
trap 'rm -rf "$stable_manifest_directory"' EXIT
node --experimental-strip-types "$repository_root/scripts/prepare-oss-stable-manifests.ts" \
  "$version" "$asset_directory" "$stable_manifest_directory"

for name in "${manifest_names[@]}"; do
  upload_file "$stable_manifest_directory/$name" "oss://$OSS_BUCKET/stable/$name"
done

while IFS= read -r uri; do
  case "$uri" in
    "oss://$OSS_BUCKET/stable/djl-mac.yml" | \
    "oss://$OSS_BUCKET/stable/djl.yml" | \
    "oss://$OSS_BUCKET/stable/latest-mac.yml" | \
    "oss://$OSS_BUCKET/stable/latest.yml") ;;
    "") ;;
    *) "$ossutil_bin" rm "$uri" --force ;;
  esac
done < <(
  "$ossutil_bin" ls "oss://$OSS_BUCKET/stable/" --recursive \
    | awk '$1 ~ /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/ { print $8 }'
)

if ! diff -u \
  <(expected_inventory "stable" "$stable_manifest_directory" "${manifest_names[@]}") \
  <(remote_inventory "stable"); then
  echo "Remote OSS stable updater metadata does not match DJL $version." >&2
  exit 70
fi

echo "Mirrored DJL $version to oss://$OSS_BUCKET/$immutable_prefix/ and advanced stable updater metadata."
