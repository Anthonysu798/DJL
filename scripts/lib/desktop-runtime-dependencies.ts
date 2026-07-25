import { resolveCatalogDependencies } from "./resolve-catalog.ts";

export function omitBundledWorkspaceDependencies(
  dependencies: Record<string, unknown>,
  excludedDependencyName?: string,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(dependencies).filter(
      ([dependencyName, dependencyVersion]) =>
        dependencyName !== excludedDependencyName &&
        !(typeof dependencyVersion === "string" && dependencyVersion.startsWith("workspace:")),
    ),
  );
}

/**
 * Returns only packages that must be installed into the staged Electron app.
 * Workspace packages are compiled into the desktop bundles and do not exist in
 * the isolated staging directory used by electron-builder.
 */
export function resolveDesktopRuntimeDependencies(
  dependencies: Record<string, unknown> | undefined,
  catalog: Record<string, unknown>,
): Record<string, unknown> {
  if (!dependencies || Object.keys(dependencies).length === 0) {
    return {};
  }

  const runtimeDependencies = omitBundledWorkspaceDependencies(dependencies, "electron");

  return resolveCatalogDependencies(runtimeDependencies, catalog, "apps/desktop");
}
