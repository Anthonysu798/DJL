# DJL Storage Identity and Shared Credentials Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `~/.djl` the canonical DJL state root and make development and packaged DJL share one persistent OpenCode credential store without sharing databases or conversations.

**Architecture:** Add pure DJL storage-path helpers in the shared package, expose a canonical managed OpenCode root from server configuration, and migrate legacy data non-destructively before provider services start. Keep legacy environment variables and legacy filesystem locations as read-only compatibility inputs while all new writes use DJL paths.

**Tech Stack:** TypeScript, Effect, Node.js filesystem APIs, Electron, Vitest, OpenCode SDK.

## Global Constraints

- DJL is the only user-facing product name.
- Default root is `~/.djl`; `DJL_HOME` wins over legacy `SYNARA_HOME`.
- Development state remains under `dev`; packaged state remains under `userdata`.
- OpenCode configuration and credentials are shared at `userdata/opencode`.
- Newly created managed workspaces use `~/Documents/DJL`; existing workspace paths are not moved.
- Migration is idempotent, non-destructive, atomic for credentials, and never logs secret values.
- Do not run `bun fmt`, `bun lint`, or `bun typecheck` unless explicitly requested.
- Never run `bun test`; use `bun run test`.

---

### Task 1: Canonical DJL storage paths and environment precedence

**Files:**

- Create: `packages/shared/src/djlStoragePaths.ts`
- Create: `packages/shared/src/djlStoragePaths.test.ts`
- Modify: `packages/shared/package.json`
- Modify: `scripts/dev-runner.ts`
- Modify: `scripts/dev-runner.test.ts`
- Modify: `apps/server/src/main.ts`
- Modify: `apps/desktop/src/main.ts`

**Interfaces:**

- Produces: `resolveDjlHome(env, homeDir)`, `resolveDjlStatePaths(baseDir, development)`, and `DJL_HOME_ENV`/`LEGACY_DJL_HOME_ENV` constants.
- Consumers: dev runner, desktop main process, server startup, and migration task.

- [ ] **Step 1: Write failing shared and dev-runner tests**

```ts
expect(resolveDjlHome({}, "/Users/test")).toBe("/Users/test/.djl");
expect(resolveDjlHome({ DJL_HOME: "/new", SYNARA_HOME: "/legacy" }, "/Users/test")).toBe("/new");
expect(resolveDjlHome({ SYNARA_HOME: "/legacy" }, "/Users/test")).toBe("/legacy");
expect(resolveDjlStatePaths("/root", true).managedOpenCodeRootDir).toBe("/root/userdata/opencode");
```

- [ ] **Step 2: Run tests and verify RED**

Run: `cd packages/shared && bun run test src/djlStoragePaths.test.ts`

Run: `bun run test scripts/dev-runner.test.ts`

Expected: failures because the DJL helpers and `DJL_HOME` precedence do not exist.

- [ ] **Step 3: Implement the pure path helpers and wire startup callers**

```ts
export const DJL_HOME_ENV = "DJL_HOME";
export const LEGACY_DJL_HOME_ENV = "SYNARA_HOME";

export function resolveDjlHome(env: NodeJS.ProcessEnv, homeDir: string): string {
  return env.DJL_HOME?.trim() || env.SYNARA_HOME?.trim() || join(homeDir, ".djl");
}

export function resolveDjlStatePaths(baseDir: string, development: boolean) {
  return {
    stateDir: join(baseDir, development ? "dev" : "userdata"),
    managedOpenCodeRootDir: join(baseDir, "userdata", "opencode"),
  } as const;
}
```

Export the subpath from `packages/shared/package.json`. Make the dev runner read `DJL_HOME` first, retain `SYNARA_HOME` fallback, and export both variables with the canonical value. Update startup copy and logs to say DJL.

- [ ] **Step 4: Run tests and verify GREEN**

Run: `cd packages/shared && bun run test src/djlStoragePaths.test.ts`

Run: `bun run test scripts/dev-runner.test.ts`

Expected: all selected tests pass.

### Task 2: Shared OpenCode credential root

**Files:**

- Modify: `apps/server/src/config.ts`
- Modify: `apps/server/src/provider/Layers/OpenCodeAdapter.ts`
- Modify: `apps/server/src/git/Layers/OpenCodeTextGeneration.ts`
- Modify: `apps/server/src/config.test.ts`
- Modify: `apps/server/src/provider/Layers/OpenCodeAdapter.test.ts`
- Modify: `apps/server/src/git/Layers/OpenCodeTextGeneration.test.ts`

**Interfaces:**

- Consumes: `resolveDjlStatePaths` from Task 1.
- Produces: `ServerConfigShape.managedOpenCodeRootDir` used by every DJL-owned OpenCode server.

- [ ] **Step 1: Write failing configuration and adapter tests**

```ts
expect(devConfig.stateDir).toBe("/root/dev");
expect(prodConfig.stateDir).toBe("/root/userdata");
expect(devConfig.managedOpenCodeRootDir).toBe("/root/userdata/opencode");
expect(prodConfig.managedOpenCodeRootDir).toBe("/root/userdata/opencode");
```

Update adapter/text-generation test doubles to assert the shared root, not `stateDir/opencode`.

- [ ] **Step 2: Run tests and verify RED**

Run: `cd apps/server && bun run test src/provider/Layers/OpenCodeAdapter.test.ts src/git/Layers/OpenCodeTextGeneration.test.ts`

Expected: the runtime receives the development state path instead of the shared userdata path.

- [ ] **Step 3: Route all managed OpenCode callers through server configuration**

Add `managedOpenCodeRootDir` to `ServerDerivedPaths` and `ServerConfigShape`. Replace local `join(serverConfig.stateDir, "opencode")` derivations with `serverConfig.managedOpenCodeRootDir`.

- [ ] **Step 4: Run tests and verify GREEN**

Run: `cd apps/server && bun run test src/provider/Layers/OpenCodeAdapter.test.ts src/git/Layers/OpenCodeTextGeneration.test.ts`

Expected: all selected tests pass and both development and packaged configurations resolve the same OpenCode root.

### Task 3: Non-destructive legacy migration

**Files:**

- Create: `apps/server/src/djlStorageMigration.ts`
- Create: `apps/server/src/djlStorageMigration.test.ts`
- Modify: `apps/server/src/main.ts`

**Interfaces:**

- Produces: `migrateLegacyDjlStorage({ canonicalBaseDir, legacyBaseDir, importLegacyDefault })` returning redacted migrated paths/provider IDs.
- Consumes: canonical shared paths from Task 1 and runs before `ServerConfig` consumers start.

- [ ] **Step 1: Write failing migration tests**

```ts
expect(await migrateFixture()).toMatchObject({ migratedProviderIds: ["deepseek"] });
expect(readCanonicalAuth()).toEqual({
  openai: { type: "api", key: "canonical" },
  deepseek: { type: "api", key: "legacy" },
});
expect(secondRun).toEqual({ migratedProviderIds: [] });
expect(JSON.stringify(result)).not.toContain("legacy");
```

Cover missing source, malformed legacy JSON, canonical-wins conflicts, provider merging, owner-only file mode, and interrupted rerun.

- [ ] **Step 2: Run tests and verify RED**

Run: `cd apps/server && bun run test src/djlStorageMigration.test.ts`

Expected: failure because migration does not exist.

- [ ] **Step 3: Implement migration with atomic writes**

Use `mkdir`, `cp` with `force: false`, JSON record validation, a same-directory temporary file opened with mode `0o600`, `sync`, and `rename`. Never include auth values in results or logs. Only auto-import `~/.synara` when the canonical root is the default `~/.djl`; explicit custom homes remain isolated.

- [ ] **Step 4: Wire migration before server services initialize**

Resolve canonical and legacy roots in `apps/server/src/main.ts`, run migration before constructing provider layers, and log only migrated relative paths and provider IDs.

- [ ] **Step 5: Run tests and verify GREEN**

Run: `cd apps/server && bun run test src/djlStorageMigration.test.ts`

Expected: all migration cases pass with no secret material in output.

### Task 4: DJL Electron profile identity

**Files:**

- Modify: `apps/desktop/src/desktopUserDataProfile.ts`
- Modify: `apps/desktop/src/desktopUserDataProfile.test.ts`
- Modify: `apps/desktop/src/main.ts`
- Modify: `apps/desktop/src/desktopStorageMigration.ts`
- Modify: `apps/desktop/src/desktopStorageMigration.test.ts`

**Interfaces:**

- Produces: Electron profile paths ending in `djl` and `djl-dev`.
- Preserves: legacy profile discovery and legacy browser-storage snapshot/key readers.

- [ ] **Step 1: Write failing profile tests**

```ts
expect(resolveDesktopUserDataPath({ appDataBase: "/app", isDevelopment: false })).toBe("/app/djl");
expect(resolveDesktopUserDataPath({ appDataBase: "/app", isDevelopment: true })).toBe(
  "/app/djl-dev",
);
```

Add a bridge fixture proving missing browser state can be imported from the legacy sibling profile without overwriting DJL state.

- [ ] **Step 2: Run tests and verify RED**

Run: `cd apps/desktop && bun run test src/desktopUserDataProfile.test.ts src/desktopStorageMigration.test.ts`

Expected: existing paths still end in legacy names.

- [ ] **Step 3: Implement DJL profile names and compatibility readers**

Change only new profile/snapshot writes to DJL names. Retain legacy constants as compatibility inputs and keep bridge validation restricted to sibling paths.

- [ ] **Step 4: Run tests and verify GREEN**

Run: `cd apps/desktop && bun run test src/desktopUserDataProfile.test.ts src/desktopStorageMigration.test.ts`

Expected: all selected tests pass.

### Task 5: Automated and Computer Use verification

**Files:**

- Modify only if a verification-discovered defect requires a new failing regression first.

**Interfaces:**

- Verifies the complete startup → save credential → restart → rediscover credential path.

- [ ] **Step 1: Run the focused regression suite**

Run: `bun run test scripts/dev-runner.test.ts`

Run: `cd packages/shared && bun run test src/djlStoragePaths.test.ts`

Run: `cd apps/server && bun run test src/djlStorageMigration.test.ts src/provider/opencodeRuntime.test.ts src/provider/Layers/OpenCodeAdapter.test.ts src/git/Layers/OpenCodeTextGeneration.test.ts`

Run: `cd apps/desktop && bun run test src/desktopUserDataProfile.test.ts src/desktopStorageMigration.test.ts`

Expected: every selected file passes with zero failures.

- [ ] **Step 2: Run an isolated Electron dev persistence test**

Dry-run then launch with `--home-dir ./.djl-credential-e2e`. Use Computer Use to save a test provider key, verify the provider is connected, stop and restart the identical command, and verify it remains connected without entering the key again.

- [ ] **Step 3: Verify filesystem layout without reading secrets**

Confirm the credential file exists only below `.djl-credential-e2e/userdata/opencode/data/opencode/auth.json`, list provider IDs with `jq 'keys'`, and confirm no credential file was written under `.djl-credential-e2e/dev/opencode`.

- [ ] **Step 4: Inspect the final diff**

Run `git diff --check` on all touched files and verify no unrelated user changes were overwritten.
