// Blocks vendored source, CLI dependencies, and copied executables after the installed-CLI cutover.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

function scanOpenCodeRuntime(
  root: string,
  skipDirectories: readonly string[],
  skipNestedRepositories: boolean,
): void {
  const violations: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (
        entry.isDirectory() &&
        skipDirectories.some((name) =>
          name.endsWith("*") ? entry.name.startsWith(name.slice(0, -1)) : name === entry.name,
        )
      )
        continue;
      if (
        /^(?:opencode|opencode\.exe|opencode-ai)$/i.test(entry.name) ||
        /^opencode-(?:darwin|linux|windows|win32)-/i.test(entry.name) ||
        /^(?:prepare-vendored-opencode|vendored-opencode|embedded-opencode-smoke)\.ts$/.test(
          entry.name,
        )
      ) {
        violations.push(path);
        continue;
      }
      if (entry.isDirectory()) {
        if (skipNestedRepositories && existsSync(join(path, ".git"))) continue;
        visit(path);
      }
      if (entry.isFile() && basename(path) === "package.json") {
        const manifest = JSON.parse(readFileSync(path, "utf8"));
        for (const field of ["dependencies", "devDependencies", "optionalDependencies"]) {
          for (const name of Object.keys(manifest[field] ?? {})) {
            if (/^opencode-ai$|^opencode-(?:darwin|linux|windows|win32)-/.test(name)) {
              violations.push(`${path}: ${field}.${name}`);
            }
          }
        }
      }
    }
  };
  visit(root);
  if (violations.length > 0) {
    throw new Error(
      `OpenCode must be installed separately; bundled runtime found:\n${violations.join("\n")}`,
    );
  }
}

// Packaged artifacts are checked exhaustively, including directories named like local tooling.
export function assertNoBundledOpenCode(root: string): void {
  scanOpenCodeRuntime(root, [], false);
}

export function assertNoBundledOpenCodeSource(root: string): void {
  scanOpenCodeRuntime(
    root,
    [
      ".git",
      "node_modules",
      ".cache",
      "output",
      "tmp",
      ".djl*",
      ".synara*",
      ".opencode",
      ".claude",
      ".codex",
      ".worktrees",
      "worktrees",
    ],
    true,
  );
}

if (import.meta.main) {
  const artifact = process.argv[2];
  if (artifact) assertNoBundledOpenCode(resolve(artifact));
  else assertNoBundledOpenCodeSource(resolve("."));
  console.log("No bundled OpenCode runtime found.");
}
