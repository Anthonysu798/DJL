#!/usr/bin/env bash
# Run a command up to three times. Hosted runners occasionally lose DNS or a
# download mid-step (for example Electron's postinstall fetching its binary
# from github.com). Only idempotent commands are retried through this script.
set -uo pipefail

attempts=3
for attempt in 1 2 3; do
  if "$@"; then
    exit 0
  fi
  if [[ "$attempt" -lt "$attempts" ]]; then
    delay=$((attempt * 20))
    echo "::warning::'$*' failed on attempt $attempt of $attempts; retrying in ${delay}s"
    sleep "$delay"
  fi
done
echo "::error::'$*' failed after $attempts attempts"
exit 1
