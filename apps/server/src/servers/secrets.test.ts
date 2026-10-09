import * as NodeServices from "@effect/platform-node/NodeServices";
import { ServerId } from "@synara/contracts";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";

import { ServerSecretStoreLive } from "../auth/Layers/ServerSecretStore";
import { ServerSecretStore } from "../auth/Services/ServerSecretStore";
import { ServerConfig } from "../config";
import {
  clearServerSecrets,
  readServerSecret,
  serverSecretName,
  storeServerSecrets,
} from "./secrets";

const makeLayer = () =>
  ServerSecretStoreLive.pipe(
    Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "djl-server-secrets-test-" })),
    Layer.provide(NodeServices.layer),
  );

const run = <A>(effect: Effect.Effect<A, unknown, ServerSecretStore>) =>
  effect.pipe(Effect.provide(makeLayer()), Effect.scoped, Effect.runPromise);

describe("server secrets", () => {
  it("stores only the provided kinds and reads them back", async () => {
    await run(
      Effect.gen(function* () {
        const store = yield* ServerSecretStore;
        const id = ServerId.makeUnsafe("srv-1");
        yield* storeServerSecrets(store, id, { password: "hunter2" });
        expect(yield* readServerSecret(store, id, "password")).toBe("hunter2");
        expect(yield* readServerSecret(store, id, "privateKey")).toBeNull();
      }),
    );
  });

  it("clears the requested kinds", async () => {
    await run(
      Effect.gen(function* () {
        const store = yield* ServerSecretStore;
        const id = ServerId.makeUnsafe("srv-2");
        yield* storeServerSecrets(store, id, { privateKey: "KEY", passphrase: "pp" });
        yield* clearServerSecrets(store, id, ["passphrase"]);
        expect(yield* readServerSecret(store, id, "privateKey")).toBe("KEY\n");
        expect(yield* readServerSecret(store, id, "passphrase")).toBeNull();
      }),
    );
  });

  it("exposes the key file path through pathOf", async () => {
    await run(
      Effect.gen(function* () {
        const store = yield* ServerSecretStore;
        const id = ServerId.makeUnsafe("srv-3");
        const path = store.pathOf(serverSecretName(id, "privateKey"));
        expect(path.endsWith("server.srv-3.privateKey.bin")).toBe(true);
      }),
    );
  });
});
