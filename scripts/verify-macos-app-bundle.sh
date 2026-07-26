#!/usr/bin/env bash
# FILE: verify-macos-app-bundle.sh
# Purpose: Verifies a mounted DJL.app carries the architecture and pinned runtimes it claims.
#
# Desktop CI's unsigned package smoke and the production release both run this, so a bundle defect
# surfaces on every push to main instead of first appearing mid-release, after signing and an Apple
# notarization round-trip have already been paid for. Signing, notarization and Gatekeeper checks
# stay in the release workflow, because package smokes are deliberately unsigned.
#
# Version pins are read from their defining module rather than repeated here, so this script cannot
# drift from the versions the build actually stages.
#
# Usage: scripts/verify-macos-app-bundle.sh <path-to-DJL.app> <arm64|x64>

set -euo pipefail

app="${1:?Pass the path to the mounted DJL.app}"
arch="${2:?Pass the release architecture (arm64 or x64)}"

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

expected_arch="$arch"
[[ "$expected_arch" == "x64" ]] && expected_arch="x86_64"

[[ -d "$app" ]] || {
  echo "No app bundle at $app." >&2
  exit 1
}

# `file -b` omits the path on purpose. With the path included, a directory named
# .../koffi/linux_arm64/... satisfies a grep for "arm64" regardless of what the binary actually is,
# which once let this check pass on ARM64 while being incapable of passing on x86_64.
main_description="$(file -b "$app/Contents/MacOS/DJL")"
grep -qF "$expected_arch" <<<"$main_description" || {
  echo "Main executable is not $expected_arch: $main_description" >&2
  exit 1
}

# Upstream native packages ship prebuilt slices for every platform they support: koffi alone carries
# FreeBSD, Linux, OpenBSD, LoongArch, RISC-V and Windows binaries, and onnxruntime-node and node-pty
# add their own. Those can never load on macOS, so require that the Mach-O slices for this
# architecture are present rather than that every bundled .node matches one.
native_count=0
while IFS= read -r -d '' native; do
  if file -b "$native" | grep -qF "$expected_arch"; then
    native_count=$((native_count + 1))
  fi
done < <(find "$app" -type f -name '*.node' -print0)
(( native_count > 0 )) || {
  echo "No $expected_arch Mach-O native module is present in the bundle." >&2
  exit 1
}

expected_onnx="$(
  sed -nE 's/.*"onnxruntime-node":[[:space:]]*"([^"]+)".*/\1/p' \
    "$repo_root/scripts/lib/desktop-stage-dependency-overrides.ts" | head -1
)"
[[ -n "$expected_onnx" ]] || {
  echo "Could not read the pinned onnxruntime-node version." >&2
  exit 1
}
onnx_manifest="$(find "$app" -path '*/onnxruntime-node/package.json' -print -quit)"
[[ -n "$onnx_manifest" ]] || {
  echo "onnxruntime-node is missing from the bundle." >&2
  exit 1
}
grep -Eq "\"version\"[[:space:]]*:[[:space:]]*\"${expected_onnx//./\\.}\"" "$onnx_manifest" || {
  echo "onnxruntime-node must be $expected_onnx in $onnx_manifest." >&2
  exit 1
}

grep -qF "owner: Anthonysu798" "$app/Contents/Resources/app-update.yml"
grep -qF "repo: DJL" "$app/Contents/Resources/app-update.yml"

expected_opencode="$(
  sed -nE 's/.*DJL_OPENCODE_VERSION = "([^"]+)".*/\1/p' \
    "$repo_root/scripts/lib/vendored-opencode.ts" | head -1
)"
[[ -n "$expected_opencode" ]] || {
  echo "Could not read the pinned OpenCode version." >&2
  exit 1
}
actual_opencode="$("$app/Contents/Resources/opencode/opencode" --version)"
[[ "$actual_opencode" == "$expected_opencode" ]] || {
  echo "Embedded OpenCode must be $expected_opencode, received $actual_opencode." >&2
  exit 1
}

echo "Verified $expected_arch bundle: $native_count native module(s), onnxruntime-node" \
  "$expected_onnx, OpenCode $expected_opencode."
