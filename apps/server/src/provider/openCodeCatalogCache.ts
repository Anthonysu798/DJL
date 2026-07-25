import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  OpenCodeListModelProvidersResult,
  ProviderListAgentsResult,
  ProviderListModelsResult,
  type OpenCodeListModelProvidersResult as OpenCodeListModelProvidersResultValue,
  type ProviderListAgentsResult as ProviderListAgentsResultValue,
  type ProviderListModelsResult as ProviderListModelsResultValue,
} from "@synara/contracts";
import { Schema } from "effect";

const CACHE_VERSION = 2;

interface PersistedOpenCodeCatalog {
  readonly version: typeof CACHE_VERSION;
  readonly providers: OpenCodeListModelProvidersResultValue | null;
  readonly models: ProviderListModelsResultValue | null;
  readonly agents: ProviderListAgentsResultValue | null;
  readonly providersUpdatedAt: number;
  readonly modelsUpdatedAt: number;
  readonly agentsUpdatedAt: number;
}

function emptyCatalog(): PersistedOpenCodeCatalog {
  return {
    version: CACHE_VERSION,
    providers: null,
    models: null,
    agents: null,
    providersUpdatedAt: 0,
    modelsUpdatedAt: 0,
    agentsUpdatedAt: 0,
  };
}

function decodeCatalog(value: unknown): PersistedOpenCodeCatalog {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return emptyCatalog();
  }
  const record = value as Record<string, unknown>;
  if (record.version !== CACHE_VERSION) {
    return emptyCatalog();
  }
  let providers: OpenCodeListModelProvidersResultValue | null = null;
  let models: ProviderListModelsResultValue | null = null;
  let agents: ProviderListAgentsResultValue | null = null;
  try {
    if (record.providers !== null && record.providers !== undefined) {
      providers = Schema.decodeUnknownSync(OpenCodeListModelProvidersResult)(record.providers);
    }
  } catch {
    providers = null;
  }
  try {
    if (record.models !== null && record.models !== undefined) {
      models = Schema.decodeUnknownSync(ProviderListModelsResult)(record.models);
    }
  } catch {
    models = null;
  }
  try {
    if (record.agents !== null && record.agents !== undefined) {
      agents = Schema.decodeUnknownSync(ProviderListAgentsResult)(record.agents);
    }
  } catch {
    agents = null;
  }
  return {
    version: CACHE_VERSION,
    providers,
    models,
    agents,
    providersUpdatedAt:
      typeof record.providersUpdatedAt === "number" && Number.isFinite(record.providersUpdatedAt)
        ? Math.max(0, record.providersUpdatedAt)
        : 0,
    modelsUpdatedAt:
      typeof record.modelsUpdatedAt === "number" && Number.isFinite(record.modelsUpdatedAt)
        ? Math.max(0, record.modelsUpdatedAt)
        : 0,
    agentsUpdatedAt:
      typeof record.agentsUpdatedAt === "number" && Number.isFinite(record.agentsUpdatedAt)
        ? Math.max(0, record.agentsUpdatedAt)
        : 0,
  };
}

export class OpenCodeCatalogCache {
  readonly #path: string;
  #catalog = emptyCatalog();
  #write = Promise.resolve();

  constructor(stateDir: string) {
    this.#path = join(stateDir, "cache", "opencode-catalog-v2.json");
  }

  async load(): Promise<void> {
    try {
      this.#catalog = decodeCatalog(JSON.parse(await readFile(this.#path, "utf8")) as unknown);
    } catch {
      this.#catalog = emptyCatalog();
    }
  }

  get providers(): OpenCodeListModelProvidersResultValue | null {
    if (!this.#catalog.providers) return null;
    return {
      ...this.#catalog.providers,
      source: "djl.cache",
      cached: true,
    };
  }

  get models(): ProviderListModelsResultValue | null {
    if (!this.#catalog.models) return null;
    return {
      ...this.#catalog.models,
      source: this.#catalog.models.source
        ? `${this.#catalog.models.source}+djl.cache`
        : "djl.cache",
      cached: true,
    };
  }

  get agents(): ProviderListAgentsResultValue | null {
    if (!this.#catalog.agents) return null;
    return {
      ...this.#catalog.agents,
      source: this.#catalog.agents.source
        ? `${this.#catalog.agents.source}+djl.cache`
        : "djl.cache",
      cached: true,
    };
  }

  providersAreFresh(now: number, ttlMs: number): boolean {
    return this.#catalog.providers !== null && now - this.#catalog.providersUpdatedAt < ttlMs;
  }

  modelsAreFresh(now: number, ttlMs: number): boolean {
    return this.#catalog.models !== null && now - this.#catalog.modelsUpdatedAt < ttlMs;
  }

  agentsAreFresh(now: number, ttlMs: number): boolean {
    return this.#catalog.agents !== null && now - this.#catalog.agentsUpdatedAt < ttlMs;
  }

  markStale(): void {
    this.#catalog = {
      ...this.#catalog,
      providersUpdatedAt: 0,
      modelsUpdatedAt: 0,
      agentsUpdatedAt: 0,
    };
  }

  async setProviders(value: OpenCodeListModelProvidersResultValue, now: number): Promise<void> {
    this.#catalog = {
      ...this.#catalog,
      providers: value,
      providersUpdatedAt: now,
    };
    await this.#persist();
  }

  async setModels(value: ProviderListModelsResultValue, now: number): Promise<void> {
    this.#catalog = {
      ...this.#catalog,
      models: value,
      modelsUpdatedAt: now,
    };
    await this.#persist();
  }

  async setAgents(value: ProviderListAgentsResultValue, now: number): Promise<void> {
    this.#catalog = {
      ...this.#catalog,
      agents: value,
      agentsUpdatedAt: now,
    };
    await this.#persist();
  }

  async #persist(): Promise<void> {
    const payload = `${JSON.stringify(this.#catalog, null, 2)}\n`;
    this.#write = this.#write
      .catch(() => undefined)
      .then(async () => {
        await mkdir(dirname(this.#path), { recursive: true, mode: 0o700 });
        const temporaryPath = `${this.#path}.${process.pid}.${Date.now()}.tmp`;
        await writeFile(temporaryPath, payload, { mode: 0o600 });
        await rename(temporaryPath, this.#path);
      });
    await this.#write;
  }
}
