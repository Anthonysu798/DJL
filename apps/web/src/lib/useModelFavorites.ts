// FILE: useModelFavorites.ts
// Purpose: Starred models for every provider. Providers that already kept favourites in their own
//          storage key (cursor, kilo, opencode, pi, djlCloud) keep using it, so model cycling and
//          older pickers see the same stars; everyone else shares one list of "provider:slug".

import type { ProviderKind } from "@djl/contracts";
import { Schema } from "effect";
import { useCallback, useMemo } from "react";

import { useLocalStorage } from "~/hooks/useLocalStorage";
import { FAVORITE_MODEL_STORAGE_KEYS, supportsModelFavorites } from "./modelFavorites";

export const SHARED_FAVORITE_MODELS_STORAGE_KEY = "djl:favourite-models:v1";

const Slugs = Schema.Array(Schema.String);

export interface FavoriteModel {
  readonly provider: ProviderKind;
  readonly slug: string;
}

function toggled(current: ReadonlyArray<string>, entry: string): string[] {
  const unique = Array.from(new Set(current.filter((item) => item.trim().length > 0)));
  return unique.includes(entry) ? unique.filter((item) => item !== entry) : [...unique, entry];
}

export function useModelFavorites() {
  const [cursor, setCursor] = useLocalStorage(FAVORITE_MODEL_STORAGE_KEYS.cursor, [], Slugs);
  const [kilo, setKilo] = useLocalStorage(FAVORITE_MODEL_STORAGE_KEYS.kilo, [], Slugs);
  const [opencode, setOpencode] = useLocalStorage(FAVORITE_MODEL_STORAGE_KEYS.opencode, [], Slugs);
  const [pi, setPi] = useLocalStorage(FAVORITE_MODEL_STORAGE_KEYS.pi, [], Slugs);
  const [djlCloud, setDjlCloud] = useLocalStorage(FAVORITE_MODEL_STORAGE_KEYS.djlCloud, [], Slugs);
  const [shared, setShared] = useLocalStorage(SHARED_FAVORITE_MODELS_STORAGE_KEY, [], Slugs);

  const favorites = useMemo<FavoriteModel[]>(() => {
    const legacy = { cursor, kilo, opencode, pi, djlCloud } as const;
    const list: FavoriteModel[] = [];
    for (const [provider, slugs] of Object.entries(legacy))
      for (const slug of slugs) list.push({ provider: provider as ProviderKind, slug });
    for (const entry of shared) {
      const split = entry.indexOf(":");
      if (split > 0)
        list.push({
          provider: entry.slice(0, split) as ProviderKind,
          slug: entry.slice(split + 1),
        });
    }
    return list;
  }, [cursor, djlCloud, kilo, opencode, pi, shared]);

  const keys = useMemo(
    () => new Set(favorites.map((favorite) => `${favorite.provider}:${favorite.slug}`)),
    [favorites],
  );

  const isFavorite = useCallback(
    (provider: ProviderKind, slug: string) => keys.has(`${provider}:${slug}`),
    [keys],
  );

  const toggleFavorite = useCallback(
    (provider: ProviderKind, slug: string) => {
      if (!supportsModelFavorites(provider)) {
        setShared((current) => toggled(current, `${provider}:${slug}`));
        return;
      }
      const set =
        provider === "cursor"
          ? setCursor
          : provider === "kilo"
            ? setKilo
            : provider === "pi"
              ? setPi
              : provider === "djlCloud"
                ? setDjlCloud
                : setOpencode;
      set((current) => toggled(current, slug));
    },
    [setCursor, setDjlCloud, setKilo, setOpencode, setPi, setShared],
  );

  return { favorites, isFavorite, toggleFavorite };
}
