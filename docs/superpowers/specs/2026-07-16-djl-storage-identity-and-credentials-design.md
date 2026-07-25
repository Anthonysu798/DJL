# DJL Storage Identity and Shared Credentials Design

## Goal

Make DJL the canonical filesystem and configuration identity while keeping existing installations usable. Development and packaged DJL must load the same provider credentials, but development databases, conversations, and settings must remain isolated from packaged user data.

## Canonical layout

The default DJL root becomes `~/.djl`.

- `~/.djl/userdata`: packaged application state.
- `~/.djl/dev`: development-only database, settings, logs, and attachments.
- `~/.djl/userdata/opencode`: canonical DJL-owned OpenCode configuration and credentials, shared by development and packaged DJL.
- `~/Documents/DJL`: canonical root for newly created managed chat workspaces, with existing legacy workspace paths left in place.
- Platform Electron profiles use `djl` and `djl-dev` names.

The server configuration exposes a canonical managed OpenCode root separately from the active state directory. OpenCode discovery, API-key mutations, model sessions, and text generation all use that shared root. No caller derives credential storage from `stateDir` directly.

## Configuration identity

`DJL_HOME` is the primary base-directory environment variable. Existing `SYNARA_HOME` remains a compatibility fallback so scripts and installations do not break immediately. When both are present, `DJL_HOME` wins.

The dev runner exports both variables with the same canonical value during the compatibility period, while user-facing descriptions and startup logs say DJL. Additional legacy `SYNARA_*` identifiers remain accepted where changing them is outside persistent-storage scope, but new storage code and public guidance use DJL names.

## Migration

Startup performs an idempotent, non-destructive migration before state services or OpenCode start.

1. Resolve the canonical DJL root.
2. If the default root is being used, inspect the legacy `~/.synara` root.
3. Copy missing `userdata` and `dev` entries into `~/.djl`; never overwrite an existing canonical file.
4. Build the canonical shared OpenCode directory under `~/.djl/userdata/opencode`.
5. Merge legacy OpenCode `auth.json` records from canonical dev, legacy userdata, and legacy dev stores by provider ID. Existing canonical provider records win; missing providers are copied. Secret values are never logged.
6. Copy missing OpenCode configuration/cache-independent state required for configured models without overwriting canonical data.
7. Write a versioned migration marker only after successful completion. Re-running after interruption is safe.

Custom `--home-dir` or `DJL_HOME` values are treated as explicit isolated profiles. They use the same internal layout and shared dev/packaged credential rule, but do not automatically import the user's default legacy home.

## Electron browser profile migration

Electron profile names change to `djl` and `djl-dev`. Existing bridge and browser-storage migration logic is extended to recognize the legacy sibling profiles and copy only missing browser state into the new DJL profile. Compatibility snapshot filenames and legacy storage-key readers remain accepted; new snapshots and storage keys use DJL names where safe.

## Failure behavior

- Migration never deletes legacy data.
- Existing canonical data always wins over legacy data.
- Credential JSON is written atomically with owner-only permissions.
- Invalid credential files are left untouched and reported as redacted warnings; DJL continues with any valid canonical credentials.
- Startup logs report source and destination profile paths and migrated provider IDs, never credential values.

## Verification

Automated tests cover:

- `~/.djl` default selection and `DJL_HOME` precedence.
- `SYNARA_HOME` compatibility fallback.
- dev and packaged state isolation.
- a shared managed OpenCode root for dev and packaged modes.
- idempotent migration and no-overwrite behavior.
- provider-ID credential merging without secret leakage.
- Electron `djl`/`djl-dev` profile selection and legacy bridge behavior.

Computer Use verification will save a test provider credential in Electron dev, confirm the provider is connected, restart the same dev command, and confirm the provider remains connected without re-entering the credential.
