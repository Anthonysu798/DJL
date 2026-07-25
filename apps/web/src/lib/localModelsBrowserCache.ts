import {
  LocalModelsSnapshot,
  type LocalModelsSnapshot as LocalModelsSnapshotValue,
} from "@synara/contracts";
import { Schema } from "effect";

const LOCAL_MODELS_KEY = "djl.local-models-snapshot.v1";

type CachedLocalModelsSnapshot = {
  readonly data: LocalModelsSnapshotValue;
  readonly updatedAt: number;
};

let localModelsMemory: CachedLocalModelsSnapshot | null | undefined;

export function readLocalModelsBrowserCache(): CachedLocalModelsSnapshot | null {
  if (localModelsMemory !== undefined) return localModelsMemory;
  if (typeof window === "undefined") return null;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(LOCAL_MODELS_KEY) ?? "") as {
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
    localModelsMemory = {
      data: Schema.decodeUnknownSync(LocalModelsSnapshot)(parsed.data),
      updatedAt: parsed.updatedAt,
    };
    return localModelsMemory;
  } catch {
    localModelsMemory = null;
    return null;
  }
}

export function writeLocalModelsBrowserCache(data: LocalModelsSnapshotValue): void {
  localModelsMemory = { data, updatedAt: Date.now() };
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      LOCAL_MODELS_KEY,
      JSON.stringify({
        data,
        updatedAt: Date.now(),
      }),
    );
  } catch {
    // The server-owned application-data snapshot remains authoritative.
  }
}
