import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { it, assert } from "@effect/vitest";
import { vi } from "vitest";
import * as generation from "./generation";
import { Effect } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import { createCampaign, defaultBrand } from "@synara/contracts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite";
import { writeCloudSession } from "../cloud/session";
import type { ServerConfigShape } from "../config";
import { marketingHandler } from "./handler";
import { resolveAgentOwner } from "./agentScope";
import { readDocument, saveDocument } from "./store";

const readJson = (response: Response) => response.json() as Promise<Record<string, unknown>>;

const session = {
  apiBaseUrl: "https://api.djl.ai",
  token: "fixture",
  email: "fixture@example.com",
  userId: "one",
  orgId: "org",
  createdAt: new Date().toISOString(),
};
function request(root: string, operation: string, body?: unknown) {
  const config = { cwd: root, stateDir: root, secretsDir: root + "/secrets" } as ServerConfigShape;
  return marketingHandler(config).pipe(
    Effect.provideService(
      HttpServerRequest.HttpServerRequest,
      HttpServerRequest.fromWeb(
        new Request(
          "http://localhost/api/marketing/" + operation,
          body === undefined
            ? undefined
            : {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
              },
        ),
      ),
    ),
    Effect.map(HttpServerResponse.toWeb),
  );
}
it.layer(SqlitePersistenceMemory)("marketing HTTP ownership", (it) => {
  it.effect(
    "denies foreign campaign writes before checking their revision and denies foreign export access",
    () =>
      Effect.gen(function* () {
        const root = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "djl-handler-owner-")));
        try {
          yield* Effect.promise(() => writeCloudSession(root + "/secrets", session));
          const campaign = { ...createCampaign("Foreign"), ownerKey: "another-owner" };
          yield* saveDocument("campaign", campaign.id, campaign, null);
          const jobId = crypto.randomUUID();
          yield* saveDocument(
            "job",
            jobId,
            { id: jobId, campaignId: campaign.id, status: "complete" },
            null,
          );
          for (const action of ["update", "approve", "confirm"]) {
            const response = yield* request(root, "command", {
              action,
              id: campaign.id,
              version: 0,
              patch: { name: "Stolen" },
              platform: "instagram",
            });
            assert.strictEqual(response.status, 404);
          }
          assert.strictEqual((yield* request(root, `job/${jobId}`)).status, 404);
          assert.strictEqual((yield* request(root, `job/${jobId}/cancel`, {})).status, 404);
          assert.strictEqual((yield* readDocument("campaign", campaign.id))!.version, 1);
        } finally {
          yield* Effect.promise(() => rm(root, { recursive: true, force: true }));
        }
      }),
  );
  it.effect(
    "scopes legacy studio brand operations to the signed-in BrandProfile and preserves offline defaults",
    () =>
      Effect.gen(function* () {
        const root = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "djl-handler-brand-")));
        try {
          yield* Effect.promise(() => writeCloudSession(root + "/secrets", session));
          const initial = yield* request(root, "state");
          const state = yield* Effect.promise(() => readJson(initial));
          assert.deepEqual(state.brand, { value: defaultBrand, version: 0 });
          const profile = { ...defaultBrand, name: "Owned brand" };
          assert.strictEqual(
            (yield* request(root, "command", { action: "brand", version: 0, value: profile }))
              .status,
            200,
          );
          const response = yield* request(root, "state");
          const saved = yield* Effect.promise(() => readJson(response));
          assert.deepEqual(saved.brand, { value: profile, version: 1 });
          assert.strictEqual(yield* readDocument("brand", "default"), null);
          yield* Effect.promise(() =>
            writeCloudSession(root + "/secrets", { ...session, userId: "two" }),
          );
          const foreignState = yield* request(root, "state");
          assert.deepEqual((yield* Effect.promise(() => readJson(foreignState))).brand, {
            value: defaultBrand,
            version: 0,
          });
          yield* Effect.promise(() => rm(root + "/secrets", { recursive: true, force: true }));
          assert.strictEqual(
            (yield* request(root, "command", {
              action: "brand",
              version: 0,
              value: { ...defaultBrand, name: "Offline" },
            })).status,
            200,
          );
          assert.strictEqual((yield* readDocument("brand", "default"))!.version, 1);
        } finally {
          yield* Effect.promise(() => rm(root, { recursive: true, force: true }));
        }
      }),
  );
  it.effect("uses owner-scoped brand facts for caption generation", () =>
    Effect.gen(function* () {
      const root = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "djl-handler-generation-")));
      const generate = vi
        .spyOn(generation, "generateCampaignCopy")
        .mockResolvedValue({ instagram: "Saved brand copy" });
      try {
        yield* Effect.promise(() =>
          writeCloudSession(root + "/secrets", { ...session, userId: "generation" }),
        );
        const scope = {
          threadId: "generate",
          stateDir: root,
          authorizedRoot: root,
          attachmentFiles: [],
        };
        const owner = yield* resolveAgentOwner(scope);
        const profile = { ...defaultBrand, name: "Account brand", facts: "Use this verified fact" };
        yield* saveDocument("brand", `agent:${owner.key}`, { ownerKey: owner.key, profile }, null);
        const legacy = yield* readDocument("brand", "default");
        yield* saveDocument(
          "brand",
          "default",
          { ...defaultBrand, name: "Legacy unrelated brand" },
          legacy?.version ?? null,
        );
        const campaign = {
          ...createCampaign("Own generation"),
          ownerKey: owner.key,
          platforms: ["instagram"],
        };
        yield* saveDocument("campaign", campaign.id, campaign, null);
        const response = yield* request(root, "generate", {
          campaignId: campaign.id,
          version: 1,
          model: "fixture",
          includeImages: false,
          consent: true,
        });
        assert.strictEqual(response.status, 200);
        assert.deepEqual(generate.mock.calls[0]![0].brand, profile);
      } finally {
        generate.mockRestore();
        yield* Effect.promise(() => rm(root, { recursive: true, force: true }));
      }
    }),
  );
  it.effect(
    "filters recipes, timelines and export jobs using their accessible parent records",
    () =>
      Effect.gen(function* () {
        const root = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "djl-handler-state-")));
        try {
          yield* Effect.promise(() => writeCloudSession(root + "/secrets", session));
          const scope = {
            threadId: "state",
            stateDir: root,
            authorizedRoot: root,
            attachmentFiles: [],
          };
          const owner = yield* resolveAgentOwner(scope);
          for (const [label, key] of [
            ["ours", owner.key],
            ["theirs", "foreign"],
          ] as const) {
            const campaign = {
              ...createCampaign(label),
              ownerKey: key,
              assetIds: [label + "-asset"],
            };
            yield* saveDocument("campaign", campaign.id, campaign, null);
            yield* saveDocument(
              "asset",
              label + "-asset",
              { id: label + "-asset", ownerKey: key, mime: "image/png" },
              null,
            );
            yield* saveDocument(
              "recipe",
              label + "-asset",
              { id: label + "-asset", recipe: {} },
              null,
            );
            yield* saveDocument(
              "timeline",
              campaign.id,
              { campaignId: campaign.id, clips: [{ assetId: label + "-asset" }] },
              null,
            );
            yield* saveDocument(
              "job",
              label + "-job",
              { id: label + "-job", campaignId: campaign.id, status: "complete" },
              null,
            );
          }
          const response = yield* request(root, "state");
          const state = yield* Effect.promise(() => readJson(response));
          for (const kind of ["campaigns", "assets", "recipes", "timelines", "jobs"])
            assert.lengthOf(state[kind] as unknown[], 1, kind);
          const created = yield* request(root, "command", {
            action: "create",
            name: "New owned draft",
          });
          assert.strictEqual(
            ((yield* Effect.promise(() => readJson(created))).value as { ownerKey: string })
              .ownerKey,
            owner.key,
          );
        } finally {
          yield* Effect.promise(() => rm(root, { recursive: true, force: true }));
        }
      }),
  );
});
