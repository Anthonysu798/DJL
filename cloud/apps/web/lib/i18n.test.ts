import { describe, expect, it } from "vitest";

import { t } from "./i18n";

type Path = readonly string[];
const paths = (value: unknown, prefix: Path = []): Path[] =>
  typeof value === "object" && value !== null
    ? Object.entries(value).flatMap(([k, v]) => paths(v, [...prefix, k]))
    : [prefix];
const at = (dict: unknown, path: Path) =>
  path.reduce<unknown>((v, k) => (v as Record<string, unknown>)[k], dict);
const key = (p: Path) => JSON.stringify(p);
const placeholders = (s: unknown) =>
  [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).toSorted();

describe("dictionaries", () => {
  it("zh-Hans translates every English string", () => {
    expect(paths(t("zh-Hans")).map(key).toSorted()).toEqual(paths(t("en")).map(key).toSorted());
  });

  it("keeps the same {placeholders} in both languages", () => {
    for (const path of paths(t("en"))) {
      expect(placeholders(at(t("zh-Hans"), path)), path.join(" > ")).toEqual(
        placeholders(at(t("en"), path)),
      );
    }
  });
});
