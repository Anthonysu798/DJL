import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  createOpenCodeCompatibilityPluginSource,
  type OpenCodeCompatibilityPolicy,
} from "./opencodeCompatibility";

export const DJL_LOCAL_OPENCODE_AGENT = "djl-local";
const localPrompt = [
  "You are DJL, a concise coding assistant running through the OpenCode harness.",
  "Use the provided tools when needed. Call tools through the tool API; never print tool-call JSON as assistant text.",
  "After a tool result, inspect it and respond with readable natural language. Do not repeat a completed tool call unless a corrected retry is necessary.",
].join("\n");

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

async function readObject(path: string): Promise<Record<string, unknown>> {
  try {
    return object(JSON.parse(await readFile(path, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

// This overlay is private to DJL-launched processes. The normal CLI config and auth
// locations are retained, and legacy remote credentials are never copied implicitly.
export async function prepareInstalledOpenCodeEnvironment(
  root: string,
  env: NodeJS.ProcessEnv,
): Promise<NodeJS.ProcessEnv> {
  const directory = join(root, "compatibility");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const source = createOpenCodeCompatibilityPluginSource(join(directory, "policies.json"));
  const hash = createHash("sha256").update(source).digest("hex").slice(0, 16);
  const pluginPath = join(directory, `plugin-${hash}.ts`);
  const temporaryPlugin = `${pluginPath}.${randomUUID()}.tmp`;
  await writeFile(temporaryPlugin, source, { mode: 0o600 });
  await rename(temporaryPlugin, pluginPath);
  const current = env.OPENCODE_CONFIG_CONTENT
    ? object(JSON.parse(env.OPENCODE_CONFIG_CONTENT))
    : {};
  const local = await readObject(join(root, "config", "opencode", "opencode.json"));
  const localProviders = object(local.provider);
  const provider = { ...object(current.provider) };
  for (const id of ["ollama", "lmstudio"]) {
    if (localProviders[id]) {
      const existing = object(provider[id]);
      const managed = object(localProviders[id]);
      provider[id] = {
        ...existing,
        ...managed,
        options: { ...object(existing.options), ...object(managed.options) },
        models: { ...object(existing.models), ...object(managed.models) },
      };
    }
  }
  return {
    ...env,
    OPENCODE_CONFIG_CONTENT: JSON.stringify({
      ...current,
      provider,
      plugin: [
        ...(Array.isArray(current.plugin) ? current.plugin : []),
        pathToFileURL(pluginPath).href,
      ],
      agent: {
        ...object(current.agent),
        [DJL_LOCAL_OPENCODE_AGENT]: {
          description: "DJL local model",
          mode: "primary",
          hidden: true,
          prompt: localPrompt,
        },
      },
    }),
  };
}

const policyWrites = new Map<string, Promise<void>>();

export async function writeOpenCodeSessionPolicy(
  root: string,
  sessionId: string,
  policy: OpenCodeCompatibilityPolicy | null,
): Promise<void> {
  const path = join(root, "compatibility", "policies.json");
  const previous = policyWrites.get(path) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(async () => {
      await mkdir(join(root, "compatibility"), { recursive: true, mode: 0o700 });
      const policies = await readObject(path);
      if (policy) policies[sessionId] = policy;
      else delete policies[sessionId];
      const temporary = `${path}.${randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify(policies), { mode: 0o600 });
      await rename(temporary, path);
    });
  policyWrites.set(path, next);
  try {
    await next;
  } finally {
    if (policyWrites.get(path) === next) policyWrites.delete(path);
  }
}
