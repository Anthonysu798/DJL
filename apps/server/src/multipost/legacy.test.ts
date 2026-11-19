import { afterEach, expect, it } from "vitest";
import { Effect, ManagedRuntime } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import sharp from "sharp";
import type { MultiPostAccount, MultiPostDraft } from "@synara/contracts";
import { layerMemory } from "../persistence/NodeSqliteClient";
import { saveDocument, readDocument } from "../marketing/store";
import { importLegacyCampaign } from "./legacy";
import { getMultiPost, multiPostScope } from "./live";
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
});
it("imports owned campaign media and recipes with fresh approval while retaining old confirmed task ownership", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "djl-multipost-migrate-"));
  const db = ManagedRuntime.make(layerMemory());
  cleanup.push(async () => {
    await db.dispose();
    await rm(dir, { recursive: true, force: true });
  });
  const config = { stateDir: dir, secretsDir: path.join(dir, "secrets") };
  await mkdir(config.secretsDir);
  await mkdir(path.join(dir, "marketing/originals"), { recursive: true });
  const sql = await db.runPromise(Effect.service(SqlClient.SqlClient));
  await db.runPromise(
    sql`CREATE TABLE marketing_documents (kind TEXT, id TEXT, body TEXT, version INTEGER, updated_at TEXT, PRIMARY KEY (kind, id))`,
  );
  const scope = await multiPostScope(dir, "chat", dir);
  const { service } = await getMultiPost(sql);
  const account = (await service.command(
    scope,
    { action: "create-account", platformKey: "x", label: "Local profile" },
    "ui",
  )) as MultiPostAccount;
  const bytes = await sharp({ create: { width: 8, height: 6, channels: 3, background: "red" } })
    .jpeg()
    .toBuffer();
  await writeFile(path.join(dir, "marketing/originals", "asset"), bytes);
  await db.runPromise(
    saveDocument(
      "asset",
      "asset",
      { id: "asset", name: "selected.jpg", mime: "image/jpeg", bytes: bytes.length },
      null,
    ),
  );
  await db.runPromise(
    saveDocument(
      "recipe",
      "asset",
      {
        recipe: {
          width: 4,
          height: 3,
          rotation: 0,
          flip: false,
          exposure: 0,
          contrast: 1,
          saturation: 1,
          temperature: 0,
        },
      },
      null,
    ),
  );
  await db.runPromise(
    saveDocument(
      "campaign",
      "campaign",
      {
        id: "campaign",
        threadId: "chat",
        name: "Retained campaign",
        assetIds: ["asset"],
        platforms: ["x"],
        captions: { x: "Exact saved caption" },
        brief: "brief",
      },
      null,
    ),
  );
  const old = {
    id: "old-task",
    confirmedAt: "2026-01-01T00:00:00Z",
    executor: "cloud",
    accountId: "oauth-old",
    approval: "old",
  };
  await db.runPromise(saveDocument("social-task", "old-task", old, null));
  const imported = (await db.runPromise(
    importLegacyCampaign(config, scope, {
      action: "import-campaign",
      campaignId: "campaign",
      version: 1,
      accountIds: [account.id],
    }),
  )) as MultiPostDraft;
  expect(imported).toMatchObject({
    approvedRevision: null,
    revision: 1,
    data: { content: "Exact saved caption" },
    targets: [{ accountId: account.id, adapterId: "DYNAMIC_X" }],
  });
  const image = imported.data.images![0]!;
  expect(image).toMatchObject({ name: "selected.png", type: "image/png" });
  const exported = await readFile(path.join(scope.mediaRoot!, image.url.slice(6)));
  expect(await sharp(exported).metadata()).toMatchObject({ format: "png", width: 4, height: 3 });
  expect(await readFile(path.join(dir, "marketing/originals", "asset"))).toEqual(bytes);
  expect((await db.runPromise(readDocument("social-task", "old-task")))?.value).toEqual(old);
  await expect(
    db.runPromise(
      importLegacyCampaign(
        config,
        { ...scope, threadId: "foreign" },
        { action: "import-campaign", campaignId: "campaign", version: 1 },
      ),
    ),
  ).rejects.toThrow(/changed|another conversation/);
  await expect(
    db.runPromise(
      importLegacyCampaign(config, scope, {
        action: "import-campaign",
        campaignId: "campaign",
        version: 9,
      }),
    ),
  ).rejects.toThrow(/changed/);
  await db.runPromise(
    saveDocument(
      "asset",
      "asset",
      { id: "asset", name: "selected.jpg", mime: "image/jpeg", ownerKey: "someone-else" },
      1,
    ),
  );
  await expect(
    db.runPromise(
      importLegacyCampaign(config, scope, {
        action: "import-campaign",
        campaignId: "campaign",
        version: 1,
      }),
    ),
  ).rejects.toThrow(/another social workspace/);
});
