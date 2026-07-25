import {
  OpenCodeListModelProvidersResult,
  ProviderListModelsResult,
  type OpenCodeListModelProvidersResult as OpenCodeListModelProvidersResultValue,
  type ProviderListModelsResult as ProviderListModelsResultValue,
} from "@synara/contracts";
import { Schema } from "effect";

const PROVIDERS_KEY = "djl.provider-catalog.v2";
const MODELS_KEY = "djl.model-catalog.v2";

type CachedValue<T> = {
  readonly data: T;
  readonly updatedAt: number;
};

let providerCatalogMemory: CachedValue<OpenCodeListModelProvidersResultValue> | null | undefined;
let modelCatalogMemory: CachedValue<ProviderListModelsResultValue> | null | undefined;

function readCachedValue<S extends Schema.Top & { readonly DecodingServices: never }>(
  key: string,
  schema: S,
): CachedValue<S["Type"]> | null {
  if (typeof window === "undefined") return null;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) ?? "") as {
      readonly data?: unknown;
      readonly updatedAt?: unknown;
    };
    if (
      typeof parsed.updatedAt !== "number" ||
      !Number.isFinite(parsed.updatedAt) ||
      parsed.updatedAt < 0
    ) {
      return null;
    }
    return {
      data: Schema.decodeUnknownSync(schema)(parsed.data),
      updatedAt: parsed.updatedAt,
    };
  } catch {
    return null;
  }
}

function writeCachedValue<T>(key: string, data: T): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      key,
      JSON.stringify({
        data,
        updatedAt: Date.now(),
      }),
    );
  } catch {
    // The server-owned application-data cache remains authoritative when
    // browser storage is unavailable, corrupt, or full.
  }
}

export function readOpenCodeProviderCatalogCache(): CachedValue<OpenCodeListModelProvidersResultValue> | null {
  if (providerCatalogMemory === undefined) {
    providerCatalogMemory = readCachedValue(PROVIDERS_KEY, OpenCodeListModelProvidersResult);
  }
  return providerCatalogMemory;
}

export function writeOpenCodeProviderCatalogCache(
  data: OpenCodeListModelProvidersResultValue,
): void {
  providerCatalogMemory = { data, updatedAt: Date.now() };
  writeCachedValue(PROVIDERS_KEY, data);
}

export function readOpenCodeModelCatalogCache(): CachedValue<ProviderListModelsResultValue> | null {
  if (modelCatalogMemory === undefined) {
    modelCatalogMemory = readCachedValue(MODELS_KEY, ProviderListModelsResult);
  }
  return modelCatalogMemory;
}

export function writeOpenCodeModelCatalogCache(data: ProviderListModelsResultValue): void {
  modelCatalogMemory = { data, updatedAt: Date.now() };
  writeCachedValue(MODELS_KEY, data);
}
