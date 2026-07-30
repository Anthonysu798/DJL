#!/usr/bin/env bun
// Streams a bounded, pinned HWT/LGT/HLT sample without persisting source text.

import { createHash } from "node:crypto";

import { selectBalancedNlpcc2026Fixtures, type Nlpcc2026Record } from "./nlpcc2026Sample";

const REPOSITORY_REVISION = "297c0dd504be7fedfbaa297f1c5ec5fd1b837fdb";
const DATA_BLOB_SHA1 = "7a02fd5271a4e05ed92642bc134547fdd581549d";
const DATA_URL = `https://raw.githubusercontent.com/NLP2CT/NLPCC-2026-Task6-Detection/${REPOSITORY_REVISION}/data/testp2_testing_label.json`;
const MAX_DATA_BYTES = 5_000_000;

function samplesPerLabel(): number {
  const index = process.argv.indexOf("--per-label");
  const raw = index >= 0 ? process.argv[index + 1] : "10";
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > 100) {
    throw new Error("--per-label must be an integer from 1 through 100.");
  }
  return parsed;
}

function decodeRecords(value: unknown): readonly Nlpcc2026Record[] {
  if (!Array.isArray(value)) throw new Error("NLPCC 2026 Phase 2 data is malformed.");
  return value.map((entry) => {
    const record = entry as {
      readonly id?: unknown;
      readonly text?: unknown;
      readonly label?: unknown;
    };
    if (
      typeof record.id !== "string" ||
      record.id.length === 0 ||
      typeof record.text !== "string" ||
      record.text.trim().length === 0 ||
      (record.label !== 0 && record.label !== 1 && record.label !== 2)
    ) {
      throw new Error("NLPCC 2026 Phase 2 record is malformed.");
    }
    return { id: record.id, text: record.text, label: record.label };
  });
}

const response = await fetch(DATA_URL, { redirect: "error" });
if (!response.ok) throw new Error(`NLPCC 2026 request failed with HTTP ${response.status}.`);
const contentLength = Number(response.headers.get("content-length"));
if (Number.isFinite(contentLength) && contentLength > MAX_DATA_BYTES) {
  throw new Error("NLPCC 2026 response exceeds the reviewed size bound.");
}
const bytes = new Uint8Array(await response.arrayBuffer());
if (bytes.byteLength > MAX_DATA_BYTES) {
  throw new Error("NLPCC 2026 response exceeds the reviewed size bound.");
}
const gitBlobSha1 = createHash("sha1")
  .update(`blob ${bytes.byteLength}\0`)
  .update(bytes)
  .digest("hex");
if (gitBlobSha1 !== DATA_BLOB_SHA1) {
  throw new Error(
    `NLPCC 2026 data hash changed: expected ${DATA_BLOB_SHA1}, received ${gitBlobSha1}.`,
  );
}

const records = decodeRecords(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
const fixtures = selectBalancedNlpcc2026Fixtures(records, samplesPerLabel(), REPOSITORY_REVISION);
process.stdout.write(`${fixtures.map((fixture) => JSON.stringify(fixture)).join("\n")}\n`);
