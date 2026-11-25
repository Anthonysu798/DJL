// FILE: SkillsStoreService.ts
// Purpose: Effect service around SkillsStore for the `skillsStore.*` RPCs. Every install or
//          removal drops the skills catalog cache so the `$` picker sees the change at once.
// Layer: Server service (provided in main.ts).

import type {
  SkillsStoreChangeResult,
  SkillsStoreCatalogFile,
  SkillsStoreSearchResultList,
  SkillsStoreSkillInput,
  SkillsStoreSnapshot,
} from "@djl/contracts";
import { Effect, Layer, Schema, ServiceMap } from "effect";

import { ServerConfig } from "../config";
import { djlSkillsDir, invalidateSkillsCatalogCache } from "../provider/skillsCatalog";
import bundledCatalog from "./catalog.json" with { type: "json" };
import { SkillsStore } from "./SkillsStore";

export class SkillsStoreServiceError extends Schema.TaggedErrorClass<SkillsStoreServiceError>()(
  "SkillsStoreServiceError",
  { operation: Schema.String, detail: Schema.String },
) {
  override get message(): string {
    return this.detail;
  }
}

export interface SkillsStoreServiceShape {
  readonly snapshot: Effect.Effect<SkillsStoreSnapshot, SkillsStoreServiceError>;
  readonly search: (
    query: string,
  ) => Effect.Effect<SkillsStoreSearchResultList, SkillsStoreServiceError>;
  readonly preview: (id: string) => Effect.Effect<{ markdown: string }, SkillsStoreServiceError>;
  readonly install: (
    input: SkillsStoreSkillInput,
  ) => Effect.Effect<SkillsStoreChangeResult, SkillsStoreServiceError>;
  readonly remove: (id: string) => Effect.Effect<SkillsStoreSnapshot, SkillsStoreServiceError>;
}

export class SkillsStoreService extends ServiceMap.Service<
  SkillsStoreService,
  SkillsStoreServiceShape
>()("djl/skillsStore/SkillsStoreService") {}

const make = Effect.gen(function* () {
  const config = yield* ServerConfig;
  const store = new SkillsStore({
    skillsDir: djlSkillsDir(config.baseDir),
    stateDir: config.stateDir,
    bundled: bundledCatalog as SkillsStoreCatalogFile,
  });
  const run = <A>(operation: string, promise: () => Promise<A>) =>
    Effect.tryPromise({
      try: promise,
      catch: (cause) =>
        new SkillsStoreServiceError({
          operation,
          detail: cause instanceof Error ? cause.message : String(cause),
        }),
    });
  const changing = <A>(promise: Promise<A>) => promise.finally(invalidateSkillsCatalogCache);
  return {
    snapshot: run("snapshot", () => store.snapshot()),
    search: (query) => run("search", async () => ({ results: await store.search(query) })),
    preview: (id) => run("preview", async () => ({ markdown: await store.preview(id) })),
    install: (input) => run("install", () => changing(store.install(input))),
    remove: (id) => run("remove", () => changing(store.remove(id))),
  } satisfies SkillsStoreServiceShape;
});

export const SkillsStoreLive = Layer.effect(SkillsStoreService, make);
