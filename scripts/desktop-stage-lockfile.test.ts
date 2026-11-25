import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { DESKTOP_STAGE_DEPENDENCY_OVERRIDES } from "./lib/desktop-stage-dependency-overrides.ts";
import {
  type BunLock,
  DESKTOP_STAGE_OVERRIDE_LOCK_PATH,
  deriveDesktopStageLock,
  lockContainsPackage,
  parseBunLock,
} from "./lib/desktop-stage-lockfile.ts";
import {
  omitBundledWorkspaceDependencies,
  resolveDesktopRuntimeDependencies,
} from "./lib/desktop-runtime-dependencies.ts";
import { resolveCatalogDependencies } from "./lib/resolve-catalog.ts";

const readRepoFile = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const readRepoJson = (path: string) => JSON.parse(readRepoFile(path));

function lock(packages: BunLock["packages"]): BunLock {
  return { lockfileVersion: 1, workspaces: {}, packages };
}

const emptyLock = lock({});

describe("parseBunLock", () => {
  it("reads trailing commas without touching commas inside strings", () => {
    const parsed = parseBunLock(
      '{ "lockfileVersion": 1, "workspaces": {}, "packages": { "a": ["a@1.0.0", "", { "dependencies": { "b": ">=1,}" }, }, "sha512-x",], }, }',
    );
    expect(parsed.packages.a).toEqual([
      "a@1.0.0",
      "",
      { dependencies: { b: ">=1,}" } },
      "sha512-x",
    ]);
  });

  it("rejects a lockfile format it does not understand", () => {
    expect(() => parseBunLock('{ "lockfileVersion": 2, "packages": {} }')).toThrow(/Unsupported/);
  });
});

describe("deriveDesktopStageLock", () => {
  const workspaceLock = lock({
    "@app/server": ["@app/server@workspace:apps/server"],
    // The server workspace resolved its own copy of a; the hoisted one belongs to another package.
    "@app/server/a": [
      "a@2.0.0",
      "",
      { dependencies: { b: "^1.0.0", shared: "^2.0.0" } },
      "sha512-a2",
    ],
    a: ["a@1.0.0", "", {}, "sha512-a1"],
    b: [
      "b@1.0.0",
      "",
      {
        dependencies: { shared: "^1.0.0" },
        optionalDependencies: { "b-native": "1.0.0" },
        peerDependencies: { host: "*", tooling: "*" },
        optionalPeers: ["tooling"],
      },
      "sha512-b1",
    ],
    "b-native": ["b-native@1.0.0", "", { os: "darwin" }, "sha512-bn"],
    host: ["host@9.0.0", "", {}, "sha512-host9"],
    "@app/server/host": ["host@1.0.0", "", {}, "sha512-host1"],
    tooling: ["tooling@1.0.0", "", {}, "sha512-tooling"],
    shared: ["shared@1.0.0", "", {}, "sha512-s1"],
    "@app/server/shared": ["shared@2.0.0", "", {}, "sha512-s2"],
    pinned: ["pinned@2.0.0", "", {}, "sha512-p2"],
    "other/pinned": ["pinned@1.0.0", "", {}, "sha512-p1"],
  });
  const stage = {
    name: "stage",
    dependencies: { a: "^2.0.0", host: "^1.0.0" },
    devDependencies: {},
    overrides: {},
  };
  const dependencyOwners = { a: "@app/server", host: "@app/server" };

  it("installs the versions the owning workspace locked, with every transitive dependency", () => {
    const derived = deriveDesktopStageLock({
      workspaceLock,
      overrideLock: emptyLock,
      stage,
      dependencyOwners,
      pinnedOverrides: {},
    });

    expect(derived.workspaces[""]).toEqual({
      name: "stage",
      dependencies: stage.dependencies,
      devDependencies: {},
    });
    expect(
      Object.fromEntries(Object.entries(derived.packages).map(([key, entry]) => [key, entry[0]])),
    ).toEqual({
      a: "a@2.0.0",
      b: "b@1.0.0",
      "b-native": "b-native@1.0.0",
      // b's peer is the app's own host, not the copy another workspace hoisted.
      host: "host@1.0.0",
      shared: "shared@2.0.0",
      // b needs the other major, so it is nested rather than replacing a's.
      "b/shared": "shared@1.0.0",
    });
    expect(derived.packages.a).toBe(workspaceLock.packages["@app/server/a"]);
  });

  it("substitutes a pinned override that bun.lock or the override lock records", () => {
    const withPinned = lock({
      ...workspaceLock.packages,
      shared: [
        "shared@1.0.0",
        "",
        { dependencies: { pinned: "^2.0.0", extra: "^1.0.0" } },
        "sha512-s1",
      ],
      extra: ["extra@1.0.0", "", {}, "sha512-e1"],
    });
    const overrideLock = lock({
      extra: ["extra@1.5.0", "", { dependencies: { leaf: "^1.0.0" } }, "sha512-e15"],
      leaf: ["leaf@1.0.0", "", {}, "sha512-leaf"],
    });
    const derived = deriveDesktopStageLock({
      workspaceLock: withPinned,
      overrideLock,
      stage,
      dependencyOwners,
      pinnedOverrides: { pinned: "1.0.0", extra: "1.5.0" },
    });

    expect(derived.packages.pinned?.[0]).toBe("pinned@1.0.0");
    expect(derived.packages.extra).toBe(overrideLock.packages.extra);
    expect(derived.packages.leaf?.[0]).toBe("leaf@1.0.0");
  });

  it("fails when a staged dependency or pinned override is not locked", () => {
    const derive = (overrides: Partial<Parameters<typeof deriveDesktopStageLock>[0]>) => () =>
      deriveDesktopStageLock({
        workspaceLock,
        overrideLock: emptyLock,
        stage,
        dependencyOwners,
        pinnedOverrides: {},
        ...overrides,
      });

    expect(derive({ stage: { ...stage, dependencies: { unlocked: "^1.0.0" } } })).toThrow(
      /unlocked is not in bun\.lock/,
    );
    expect(
      derive({
        workspaceLock: lock({
          ...workspaceLock.packages,
          shared: ["shared@1.0.0", "", { dependencies: { missing: "^1.0.0" } }, "sha512-s1"],
        }),
      }),
    ).toThrow(/missing of shared@1\.0\.0 is not in bun\.lock/);
    expect(derive({ pinnedOverrides: { shared: "3.0.0" } })).toThrow(
      /shared@3\.0\.0 is locked by neither/,
    );
  });
});

describe("the repository's staged desktop lock", () => {
  const rootPackageJson = readRepoJson("package.json");
  const serverPackageJson = readRepoJson("apps/server/package.json");
  const desktopPackageJson = readRepoJson("apps/desktop/package.json");
  const catalog = rootPackageJson.workspaces.catalog;
  const workspaceLock = parseBunLock(readRepoFile("bun.lock"));
  const overrideLock = parseBunLock(readRepoFile(DESKTOP_STAGE_OVERRIDE_LOCK_PATH));
  const missingOverrides = Object.fromEntries(
    Object.entries(DESKTOP_STAGE_DEPENDENCY_OVERRIDES).filter(
      ([name, version]) => !lockContainsPackage(workspaceLock, name, version),
    ),
  );

  // Mirrors the stage manifest scripts/build-desktop-artifact.ts writes.
  const stage = {
    name: "djl-desktop",
    dependencies: {
      ...resolveCatalogDependencies(
        omitBundledWorkspaceDependencies(serverPackageJson.dependencies),
        catalog,
        "apps/server",
      ),
      ...resolveDesktopRuntimeDependencies(desktopPackageJson.dependencies, catalog),
    },
    devDependencies: { electron: desktopPackageJson.dependencies.electron },
    overrides: {
      ...DESKTOP_STAGE_DEPENDENCY_OVERRIDES,
      ...resolveCatalogDependencies(rootPackageJson.overrides, catalog, "apps/desktop"),
    },
  };
  const derived = deriveDesktopStageLock({
    workspaceLock,
    overrideLock,
    stage,
    dependencyOwners: {
      ...Object.fromEntries(
        Object.keys(serverPackageJson.dependencies).map((name) => [name, serverPackageJson.name]),
      ),
      ...Object.fromEntries(
        Object.keys(desktopPackageJson.dependencies).map((name) => [name, desktopPackageJson.name]),
      ),
    },
    pinnedOverrides: DESKTOP_STAGE_DEPENDENCY_OVERRIDES,
  });

  it("stages only packages recorded in bun.lock or the committed override lock", () => {
    const locked = new Set(
      [...Object.values(workspaceLock.packages), ...Object.values(overrideLock.packages)].map(
        (entry) => JSON.stringify(entry),
      ),
    );
    const unlocked = Object.values(derived.packages).filter(
      (entry) => !locked.has(JSON.stringify(entry)),
    );
    expect(unlocked).toEqual([]);
    expect(Object.keys(derived.packages).length).toBeGreaterThan(100);
  });

  it("stages every direct dependency at its locked version and every override at its pin", () => {
    for (const name of [...Object.keys(stage.dependencies), "electron"]) {
      expect(derived.packages[name], name).toBeDefined();
    }
    expect(derived.packages.electron?.[0]).toBe(
      `electron@${desktopPackageJson.dependencies.electron}`,
    );
    expect(derived.packages.effect?.[0]).toBe(`effect@${catalog.effect}`);
    for (const [name, version] of Object.entries(DESKTOP_STAGE_DEPENDENCY_OVERRIDES)) {
      const staged = Object.entries(derived.packages).filter(
        ([key]) => key === name || key.endsWith(`/${name}`),
      );
      for (const [key, entry] of staged) expect(entry[0], key).toBe(`${name}@${version}`);
    }
    expect(derived.packages["onnxruntime-node"]?.[0]).toBe("onnxruntime-node@1.23.2");
  });

  it("keeps the committed override lock in step with the pinned overrides", () => {
    // Regenerate with `node scripts/update-desktop-stage-override-lock.ts`.
    expect(overrideLock.workspaces[""]?.dependencies).toEqual(missingOverrides);
    expect(overrideLock.overrides).toEqual(DESKTOP_STAGE_DEPENDENCY_OVERRIDES);
  });

  it("packages with the one electron-builder version bun.lock pins", () => {
    const version = readRepoJson("scripts/package.json").devDependencies["electron-builder"];
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(lockContainsPackage(workspaceLock, "electron-builder", version)).toBe(true);
    const buildScript = readRepoFile("scripts/build-desktop-artifact.ts");
    expect(buildScript).not.toMatch(/bun x|bunx|npx/);
    expect(buildScript).toContain('resolve("electron-builder/cli.js")');
  });
});
