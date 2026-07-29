#!/usr/bin/env bun
// Streams a bounded, revision-pinned DetectRL-ZH test sample without persisting source text.

import { createHash } from "node:crypto";

import { selectBalancedNlpccZhFixtures, type NlpccZhRecord } from "./nlpccZhSample";

const REPOSITORY_REVISION = "8496a447b432aac1801041d4b543cd6b863c4c56";
const DATA_BLOB_SHA1 = "44655ebbf8050c0ff6f6f7a9c153488d9000651a";
const DATA_URL = `https://raw.githubusercontent.com/NLP2CT/NLPCC-2025-Task1/${REPOSITORY_REVISION}/data/test_with_label.json`;
const MAX_DATA_BYTES = 20_000_000;

function samplesPerLabel(): number {
  const index = process.argv.indexOf("--per-label");
  const raw = index >= 0 ? process.argv[index + 1] : "10";
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > 100) {
    throw new Error("--per-label must be an integer from 1 through 100.");
  }
  return parsed;
}

function decodeRecords(value: unknown): readonly NlpccZhRecord[] {
  if (!Array.isArray(value)) throw new Error("NLPCC test data is malformed.");
  return value.map((entry) => {
    const record = entry as {
      readonly id?: unknown;
      readonly text?: unknown;
      readonly label?: unknown;
    };
    if (
      !Number.isSafeInteger(record.id) ||
      typeof record.text !== "string" ||
      record.text.trim().length === 0 ||
      (record.label !== 0 && record.label !== 1)
    ) {
      throw new Error("NLPCC test record is malformed.");
    }
    return { id: record.id as number, text: record.text, label: record.label };
  });
}

const response = await fetch(DATA_URL, { redirect: "error" });
if (!response.ok) throw new Error(`NLPCC request failed with HTTP ${response.status}.`);
const contentLength = Number(response.headers.get("content-length"));
if (Number.isFinite(contentLength) && contentLength > MAX_DATA_BYTES) {
  throw new Error("NLPCC response exceeds the reviewed size bound.");
}
const bytes = new Uint8Array(await response.arrayBuffer());
if (bytes.byteLength > MAX_DATA_BYTES) {
  throw new Error("NLPCC response exceeds the reviewed size bound.");
}
const gitBlobSha1 = createHash("sha1")
  .update(`blob ${bytes.byteLength}\0`)
  .update(bytes)
  .digest("hex");
if (gitBlobSha1 !== DATA_BLOB_SHA1) {
  throw new Error(`NLPCC data hash changed: expected ${DATA_BLOB_SHA1}, received ${gitBlobSha1}.`);
}

const records = decodeRecords(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
const fixtures = selectBalancedNlpccZhFixtures(records, samplesPerLabel(), REPOSITORY_REVISION);
process.stdout.write(`${fixtures.map((fixture) => JSON.stringify(fixture)).join("\n")}\n`);
