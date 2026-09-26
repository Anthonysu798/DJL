/** Writes packages/contracts/fixtures/cloud/<name>.json from src/cloud/fixtures.ts. */
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";

import { encodeCloudFixtures } from "../src/cloud/fixtures";

const dir = new URL("../fixtures/cloud/", import.meta.url);
mkdirSync(dir, { recursive: true });
for (const file of readdirSync(dir)) if (file.endsWith(".json")) rmSync(new URL(file, dir));
for (const [name, value] of Object.entries(encodeCloudFixtures()))
  writeFileSync(new URL(`${name}.json`, dir), `${JSON.stringify(value, null, 2)}\n`);
