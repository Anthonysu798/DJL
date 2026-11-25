// FILE: desktop-stage-lockfile.ts
// Purpose: Derives the staged desktop app's bun.lock from the workspace bun.lock, so a packaged
//          build installs the exact dependency graph the workspace locked instead of resolving
//          version ranges fresh at release time.
// Layer: Release/build script support

type LockEntry = ReadonlyArray<unknown>;

export interface BunLock {
  readonly lockfileVersion: number;
  readonly configVersion?: number;
  readonly workspaces: Record<string, { readonly name?: string } & Record<string, unknown>>;
  readonly overrides?: Record<string, string>;
  readonly packages: Record<string, LockEntry>;
}

interface LockInfo {
  readonly dependencies?: Record<string, string>;
  readonly optionalDependencies?: Record<string, string>;
  readonly peerDependencies?: Record<string, string>;
  readonly optionalPeers?: ReadonlyArray<string>;
}

interface LockNode {
  readonly lock: BunLock;
  readonly key: string;
}

export interface DesktopStageLockInput {
  /** The repository bun.lock. */
  readonly workspaceLock: BunLock;
  /** Committed lock for pinned override versions the workspace lock does not contain. */
  readonly overrideLock: BunLock;
  readonly stage: {
    readonly name: string;
    readonly dependencies: Record<string, unknown>;
    readonly devDependencies: Record<string, unknown>;
    readonly overrides: Record<string, unknown>;
  };
  /** Workspace package whose lock resolution each staged root dependency reuses. */
  readonly dependencyOwners: Record<string, string>;
  /** Exact versions the stage deliberately substitutes for the workspace resolution. */
  readonly pinnedOverrides: Record<string, string>;
}

/** bun.lock is JSON with trailing commas. */
export function parseBunLock(text: string): BunLock {
  let json = "";
  let inString = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (inString) {
      json += char;
      if (char === "\\") {
        index += 1;
        json += text[index] ?? "";
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
    } else if (char === ",") {
      const next = /\S/.exec(text.slice(index + 1))?.[0];
      if (next === "}" || next === "]") continue;
    }
    json += char;
  }
  const lock = JSON.parse(json) as BunLock;
  if (lock.lockfileVersion !== 1 || typeof lock.packages !== "object") {
    throw new Error(`Unsupported bun.lock format (lockfileVersion ${lock.lockfileVersion}).`);
  }
  return lock;
}

// A lock key is a node_modules path of package names: "a/@scope/b" is a's nested @scope/b.
function splitKey(key: string): string[] {
  const parts = key.split("/");
  const segments: string[] = [];
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index]!;
    segments.push(part.startsWith("@") ? `${part}/${parts[(index += 1)]}` : part);
  }
  return segments;
}

function candidateKeys(parentKey: string, name: string): string[] {
  const segments = parentKey === "" ? [] : splitKey(parentKey);
  const keys: string[] = [];
  for (let depth = segments.length; depth >= 0; depth -= 1) {
    keys.push([...segments.slice(0, depth), name].join("/"));
  }
  return keys;
}

function identOf(node: LockNode): string {
  return String(node.lock.packages[node.key]![0]);
}

function infoOf(node: LockNode): LockInfo {
  const info = node.lock.packages[node.key]!.find(
    (part) => typeof part === "object" && part !== null,
  );
  return (info ?? {}) as LockInfo;
}

function resolveInLock(lock: BunLock, parentKey: string, name: string): LockNode | undefined {
  const key = candidateKeys(parentKey, name).find((candidate) => candidate in lock.packages);
  return key === undefined ? undefined : { lock, key };
}

function findByIdent(lock: BunLock, ident: string): LockNode | undefined {
  const key = Object.keys(lock.packages)
    .filter((candidate) => lock.packages[candidate]![0] === ident)
    .toSorted((left, right) => splitKey(left).length - splitKey(right).length)[0];
  return key === undefined ? undefined : { lock, key };
}

export function deriveDesktopStageLock(input: DesktopStageLockInput): BunLock {
  const { workspaceLock, overrideLock, pinnedOverrides } = input;

  const overrideNode = (name: string): LockNode => {
    const ident = `${name}@${pinnedOverrides[name]}`;
    const node = findByIdent(workspaceLock, ident) ?? findByIdent(overrideLock, ident);
    if (!node) {
      throw new Error(
        `Staged override ${ident} is locked by neither bun.lock nor the stage override lockfile. ` +
          "Run `node scripts/update-desktop-stage-override-lock.ts` and commit the result.",
      );
    }
    return node;
  };

  // Every dependency a staged package needs, resolved the way its own lockfile resolved it.
  const dependenciesOf = (node: LockNode): Array<readonly [string, LockNode]> => {
    const info = infoOf(node);
    const optionalPeers = new Set(info.optionalPeers ?? []);
    const edges = new Map<string, LockNode>();
    const add = (name: string, required: boolean, peer = false) => {
      if (edges.has(name)) return;
      const target =
        peer && rootNodes.has(name)
          ? rootNodes.get(name)
          : name in pinnedOverrides
            ? overrideNode(name)
            : resolveInLock(node.lock, node.key, name);
      if (target) {
        edges.set(name, target);
      } else if (required) {
        throw new Error(
          `Staged dependency ${name} of ${identOf(node)} is not in bun.lock. Run \`bun install\` and commit bun.lock.`,
        );
      }
    };
    for (const name of Object.keys(info.dependencies ?? {})) add(name, true);
    for (const name of Object.keys(info.optionalDependencies ?? {})) add(name, false);
    for (const name of Object.keys(info.peerDependencies ?? {})) {
      // An optional peer is used when something else installs it, never installed for itself.
      if (!optionalPeers.has(name)) add(name, false, true);
    }
    return [...edges];
  };

  // bun gives a package the app's own copy of a peer when the app depends on that peer directly.
  const rootNodes = new Map<string, LockNode>();
  const placed = new Map<string, LockNode>();
  const queue: string[] = [];
  const place = (key: string, node: LockNode) => {
    placed.set(key, node);
    queue.push(key);
  };

  for (const name of [
    ...Object.keys(input.stage.dependencies),
    ...Object.keys(input.stage.devDependencies),
  ]) {
    if (placed.has(name)) continue;
    const owner = input.dependencyOwners[name];
    const node =
      name in pinnedOverrides
        ? overrideNode(name)
        : owner === undefined
          ? undefined
          : resolveInLock(workspaceLock, owner, name);
    if (!node) {
      throw new Error(
        `Staged dependency ${name} is not in bun.lock. Run \`bun install\` and commit bun.lock.`,
      );
    }
    rootNodes.set(name, node);
    place(name, node);
  }

  // Lay the graph out as a node_modules tree: reuse the nearest visible copy of a package,
  // hoist a package nobody has placed yet to the root, and nest a conflicting version under
  // the package that needs it.
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const parentKey = queue[cursor]!;
    for (const [name, target] of dependenciesOf(placed.get(parentKey)!)) {
      const visibleKey = candidateKeys(parentKey, name).find((candidate) => placed.has(candidate));
      if (visibleKey === undefined) {
        place(name, target);
      } else if (identOf(placed.get(visibleKey)!) !== identOf(target)) {
        place(`${parentKey}/${name}`, target);
      }
    }
  }

  return {
    lockfileVersion: workspaceLock.lockfileVersion,
    ...(workspaceLock.configVersion === undefined
      ? {}
      : { configVersion: workspaceLock.configVersion }),
    workspaces: {
      "": {
        name: input.stage.name,
        dependencies: input.stage.dependencies,
        devDependencies: input.stage.devDependencies,
      },
    },
    overrides: input.stage.overrides as Record<string, string>,
    packages: Object.fromEntries(
      [...placed.keys()].toSorted().map((key) => {
        const node = placed.get(key)!;
        return [key, node.lock.packages[node.key]!];
      }),
    ),
  };
}

/** Repo-relative path of the committed lock for pinned overrides bun.lock does not contain. */
export const DESKTOP_STAGE_OVERRIDE_LOCK_PATH = "scripts/desktop-stage-overrides.bun.lock";

export function lockContainsPackage(lock: BunLock, name: string, version: string): boolean {
  return findByIdent(lock, `${name}@${version}`) !== undefined;
}
