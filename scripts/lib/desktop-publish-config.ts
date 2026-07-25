// FILE: desktop-publish-config.ts
// Purpose: Resolves deterministic Electron Builder GitHub publish metadata.
// Layer: Release/build helper

export interface DesktopGitHubPublishConfig {
  readonly provider: "github";
  readonly owner: string;
  readonly repo: string;
  readonly releaseType: "release";
}

export interface DesktopGenericPublishConfig {
  readonly provider: "generic";
  readonly url: string;
}

export type DesktopPublishConfig = DesktopGitHubPublishConfig | DesktopGenericPublishConfig;

interface PackageRepositoryObject {
  readonly url?: unknown;
}

export interface ResolveDesktopGitHubPublishConfigInput {
  readonly configuredRepository?: string | undefined;
  readonly githubRepository?: string | undefined;
  readonly packageRepository?: unknown;
}

export interface ResolveDesktopPublishConfigInput extends ResolveDesktopGitHubPublishConfigInput {
  readonly configuredUpdateUrl?: string | undefined;
}

function packageRepositoryUrl(repository: unknown): string | undefined {
  if (typeof repository === "string") return repository.trim() || undefined;
  if (!repository || typeof repository !== "object") return undefined;
  const url = (repository as PackageRepositoryObject).url;
  return typeof url === "string" ? url.trim() || undefined : undefined;
}

function parseOwnerAndRepo(raw: string, allowGitHubUrl: boolean): [string, string] | undefined {
  let candidate = raw.trim();
  if (allowGitHubUrl) {
    candidate = candidate
      .replace(/^git\+/, "")
      .replace(/^git@github\.com:/i, "")
      .replace(/^ssh:\/\/git@github\.com\//i, "")
      .replace(/^https?:\/\/github\.com\//i, "");
  }
  candidate = candidate.replace(/\.git\/?$/i, "").replace(/\/$/, "");
  const [owner, repo, ...rest] = candidate.split("/");
  if (!owner || !repo || rest.length > 0 || /[:?#]/.test(owner) || /[:?#]/.test(repo)) {
    return undefined;
  }
  return [owner, repo];
}

export function resolveDesktopGitHubPublishConfig(
  input: ResolveDesktopGitHubPublishConfigInput,
): DesktopGitHubPublishConfig | undefined {
  const configuredRepository = input.configuredRepository?.trim();
  const githubRepository = input.githubRepository?.trim();
  const explicitRepository = configuredRepository || githubRepository;
  const repository = explicitRepository ?? packageRepositoryUrl(input.packageRepository);
  if (!repository) return undefined;

  const parsed = parseOwnerAndRepo(repository, explicitRepository === undefined);
  if (!parsed) return undefined;
  const [owner, repo] = parsed;
  return { provider: "github", owner, repo, releaseType: "release" };
}

function resolveGenericUpdateUrl(raw: string | undefined): string | undefined {
  const candidate = raw?.trim();
  if (!candidate) return undefined;

  try {
    const url = new URL(candidate);
    if (
      url.protocol !== "https:" ||
      !url.hostname ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      return undefined;
    }
    return url.toString().replace(/\/$/, "");
  } catch {
    return undefined;
  }
}

/**
 * Resolves the baked electron-updater provider. A validated explicit HTTPS
 * download origin takes precedence so a private source repository can publish
 * public updates without exposing GitHub as the updater backend.
 */
export function resolveDesktopPublishConfig(
  input: ResolveDesktopPublishConfigInput,
): DesktopPublishConfig | undefined {
  const genericUrl = resolveGenericUpdateUrl(input.configuredUpdateUrl);
  if (genericUrl) return { provider: "generic", url: genericUrl };
  return resolveDesktopGitHubPublishConfig(input);
}
