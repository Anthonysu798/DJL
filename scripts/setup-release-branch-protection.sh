#!/usr/bin/env bash
# FILE: setup-release-branch-protection.sh
# Purpose: Applies the branch protection that the production release preflight requires on main.
#
# `.github/workflows/desktop-release.yml` refuses to build a release unless the tagged commit lives
# on a protected `main`. This script is the single source of truth for that protection so the
# settings are reviewable and reproducible instead of a one-off click in the GitHub UI.
#
# Re-running it is safe: the GitHub API replaces the protection with the same definition.
#
# Usage: scripts/setup-release-branch-protection.sh [repository]

set -euo pipefail

repository="${1:-Anthonysu798/DJL}"
branch="main"

command -v gh >/dev/null 2>&1 || {
  echo "The GitHub CLI (gh) is required." >&2
  exit 2
}

# `desktop-ci` is the small aggregate job that depends on every required lane, so it is deliberately
# the only required context. Admin enforcement stays off so maintainers keep direct-to-main pushes,
# while force pushes and deletions remain blocked for everyone.
gh api \
  --method PUT \
  "repos/$repository/branches/$branch/protection" \
  --input - <<'JSON' >/dev/null
{
  "required_status_checks": {
    "strict": false,
    "contexts": ["desktop-ci"]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": null,
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "required_linear_history": true,
  "required_conversation_resolution": true
}
JSON

protected="$(gh api "repos/$repository/branches/$branch" --jq .protected)"
[[ "$protected" == "true" ]] || {
  echo "Branch protection did not apply to $repository@$branch." >&2
  exit 1
}

echo "Protected $repository@$branch with desktop-ci as the only required check."
