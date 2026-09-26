import { readdirSync, readFileSync } from "node:fs";

import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { cloudFixtures, encodeCloudFixtures } from "./fixtures";

const dir = new URL("../../fixtures/cloud/", import.meta.url);

describe("cloud contract fixtures", () => {
  it("has exactly one JSON file per fixture, matching what the schemas encode", () => {
    const expected = encodeCloudFixtures();
    const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
    expect(files.toSorted()).toEqual(
      Object.keys(expected)
        .map((n) => `${n}.json`)
        .toSorted(),
    );
    for (const [name, value] of Object.entries(expected)) {
      const onDisk = JSON.parse(readFileSync(new URL(`${name}.json`, dir), "utf8"));
      // Out of date? Run `bun run --cwd packages/contracts fixtures:cloud`.
      expect(onDisk, name).toEqual(value);
    }
  });

  it("decodes every fixture file with its schema", () => {
    for (const [name, fixture] of Object.entries(cloudFixtures)) {
      const onDisk = JSON.parse(readFileSync(new URL(`${name}.json`, dir), "utf8"));
      expect(() => Schema.decodeUnknownSync(fixture.schema)(onDisk), name).not.toThrow();
    }
  });
});
