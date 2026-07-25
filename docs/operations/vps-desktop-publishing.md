# Legacy VPS desktop publishing

The VPS is no longer DJL's normal release destination. It remains available only for the one-time
GitHub updater bridge and emergency recovery.

Use the canonical [desktop release runbook](../release.md#one-time-bridge-migration). Every legacy
operation requires explicit `DJL_RELEASE_HOST`, `DJL_RELEASE_SSH_KEY`, `DJL_RELEASE_ROOT`,
`DJL_RELEASE_VERSION`, and `DJL_RELEASE_ASSET_DIR` values. Never rebuild artifacts for the VPS;
promote the exact bytes already verified in the canonical GitHub Release.
