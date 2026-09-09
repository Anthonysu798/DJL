// FILE: secrets.ts
// Purpose: Per-server secret names and store/clear/read helpers over ServerSecretStore.
// Layer: Servers domain helpers
import type { ServerId, ServerSecretInput, ServerSecretKind } from "@synara/contracts";
import { Effect } from "effect";

import type { SecretStoreError, ServerSecretStoreShape } from "../auth/Services/ServerSecretStore";

export const ALL_SERVER_SECRET_KINDS: ReadonlyArray<ServerSecretKind> = [
  "privateKey",
  "passphrase",
  "password",
];

export const serverSecretName = (id: ServerId, kind: ServerSecretKind): string =>
  `server.${id}.${kind}`;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const storeServerSecrets = (
  store: ServerSecretStoreShape,
  id: ServerId,
  secret: ServerSecretInput | undefined,
): Effect.Effect<void, SecretStoreError> =>
  Effect.forEach(
    ALL_SERVER_SECRET_KINDS,
    (kind) => {
      const value = secret?.[kind];
      if (value === undefined) return Effect.void;
      // A private key must end with a newline or OpenSSH rejects the file.
      const normalized = kind === "privateKey" && !value.endsWith("\n") ? `${value}\n` : value;
      return store.set(serverSecretName(id, kind), encoder.encode(normalized));
    },
    { discard: true },
  );

export const clearServerSecrets = (
  store: ServerSecretStoreShape,
  id: ServerId,
  kinds: ReadonlyArray<ServerSecretKind>,
): Effect.Effect<void, SecretStoreError> =>
  Effect.forEach(kinds, (kind) => store.remove(serverSecretName(id, kind)), { discard: true });

export const readServerSecret = (
  store: ServerSecretStoreShape,
  id: ServerId,
  kind: ServerSecretKind,
): Effect.Effect<string | null, SecretStoreError> =>
  store
    .get(serverSecretName(id, kind))
    .pipe(Effect.map((bytes) => (bytes ? decoder.decode(bytes) : null)));
