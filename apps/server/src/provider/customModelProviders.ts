import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Schema } from "effect";
import {
  CustomModelProvider,
  FetchCustomModelsInput,
  type FetchCustomModelsResult,
} from "@synara/contracts";

export async function readCustomProviders(
  root: string,
): Promise<ReadonlyArray<CustomModelProvider>> {
  try {
    return Schema.decodeUnknownSync(Schema.Array(CustomModelProvider))(
      JSON.parse(await readFile(join(root, "custom-providers.json"), "utf8")),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

const writes = new Map<string, Promise<void>>();
async function updateProviders(
  root: string,
  update: (providers: ReadonlyArray<CustomModelProvider>) => ReadonlyArray<CustomModelProvider>,
): Promise<void> {
  const next = (writes.get(root) ?? Promise.resolve())
    .catch(() => undefined)
    .then(async () => {
      const providers = update(await readCustomProviders(root));
      await mkdir(root, { recursive: true, mode: 0o700 });
      const path = join(root, "custom-providers.json");
      const temporary = `${path}.${randomUUID()}.tmp`;
      await writeFile(temporary, `${JSON.stringify(providers, null, 2)}\n`, { mode: 0o600 });
      await rename(temporary, path);
    });
  writes.set(root, next);
  try {
    await next;
  } finally {
    if (writes.get(root) === next) writes.delete(root);
  }
}

export function writeCustomProvider(
  root: string,
  input: CustomModelProvider,
  replaceExisting = false,
): Promise<void> {
  const provider = Schema.decodeUnknownSync(CustomModelProvider)(input);
  return updateProviders(root, (providers) => {
    const exists = providers.some((entry) => entry.providerId === provider.providerId);
    if (exists && !replaceExisting)
      throw new Error("This provider ID already exists. Choose another ID.");
    if (!exists && replaceExisting)
      throw new Error("This custom provider no longer exists. Create it again.");
    return [...providers.filter((entry) => entry.providerId !== provider.providerId), provider];
  });
}

export function removeCustomProvider(root: string, providerId: string): Promise<void> {
  return updateProviders(root, (providers) =>
    providers.filter((entry) => entry.providerId !== providerId),
  );
}

export function customProviderConfig(provider: CustomModelProvider) {
  return {
    name: provider.name,
    npm: {
      "openai-chat": "@ai-sdk/openai-compatible",
      "openai-responses": "@ai-sdk/openai",
      anthropic: "@ai-sdk/anthropic",
    }[provider.protocol],
    options: { baseURL: provider.baseUrl.replace(/\/+$/, "") },
    models: Object.fromEntries(
      provider.models.map((model) => [model.id, { id: model.id, name: model.name }]),
    ),
  };
}

export async function fetchSavedCustomModels(
  root: string,
  input: FetchCustomModelsInput & { readonly providerId: string },
  authPath: string,
  request: (url: string, init: RequestInit) => Promise<Response> = fetch,
): Promise<FetchCustomModelsResult> {
  if (input.apiKey) return fetchCustomModels(input, request);
  const provider = (await readCustomProviders(root)).find(
    (entry) => entry.providerId === input.providerId,
  );
  if (!provider) throw new Error("Custom provider not found.");
  if (
    provider.baseUrl.replace(/\/+$/, "") !== input.baseUrl.replace(/\/+$/, "") ||
    provider.protocol !== input.protocol
  ) {
    throw new Error("Enter an API key to fetch models from a changed endpoint or protocol.");
  }
  let key: string | undefined;
  try {
    const auth: unknown = JSON.parse(await readFile(authPath, "utf8"));
    if (auth && typeof auth === "object" && Object.hasOwn(auth, input.providerId)) {
      const entry = (auth as Record<string, unknown>)[input.providerId];
      if (
        entry &&
        typeof entry === "object" &&
        "type" in entry &&
        entry.type === "api" &&
        "key" in entry &&
        typeof entry.key === "string"
      )
        key = entry.key;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT")
      // oxlint-disable-next-line preserve-caught-error -- Credential parse errors may contain secret content.
      throw new Error("Could not read the saved credential. Enter the key again.");
  }
  return fetchCustomModels({ ...input, ...(key ? { apiKey: key } : {}) }, request);
}

export async function fetchCustomModels(
  input: FetchCustomModelsInput,
  request: (url: string, init: RequestInit) => Promise<Response> = fetch,
): Promise<FetchCustomModelsResult> {
  const parsed = Schema.decodeUnknownSync(FetchCustomModelsInput)(input);
  const headers: Record<string, string> = { Accept: "application/json" };
  if (parsed.protocol === "anthropic") {
    headers["anthropic-version"] = "2023-06-01";
    if (parsed.apiKey) headers["x-api-key"] = parsed.apiKey;
  } else if (parsed.apiKey) headers.Authorization = `Bearer ${parsed.apiKey}`;
  const response = await request(`${parsed.baseUrl.replace(/\/+$/, "")}/models`, {
    headers,
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Model discovery returned HTTP ${response.status}.`);
  const payload: unknown = await response.json();
  const data =
    payload && typeof payload === "object" && "data" in payload ? payload.data : undefined;
  if (!Array.isArray(data)) throw new Error("The endpoint did not return a model list.");
  const models = new Map<string, { id: string; name: string }>();
  for (const entry of data) {
    if (!entry || typeof entry.id !== "string" || !entry.id.trim() || entry.id.length > 256)
      continue;
    const id = entry.id.trim();
    if (models.has(id)) continue;
    const label = entry.display_name ?? entry.name;
    models.set(id, {
      id,
      name: typeof label === "string" && label.trim() ? label.trim().slice(0, 256) : id,
    });
    if (models.size === 500) break;
  }
  return { models: [...models.values()] };
}
