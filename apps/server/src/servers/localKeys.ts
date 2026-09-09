// FILE: localKeys.ts
// Purpose: Candidate private keys in ~/.ssh for the key-path picker.
// Layer: Servers domain helpers
import { Effect, FileSystem, Path } from "effect";

export const listLocalPrivateKeys = (homeDir: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const sshDir = path.join(homeDir, ".ssh");
    const entries = yield* fileSystem
      .readDirectory(sshDir)
      .pipe(Effect.orElseSucceed(() => [] as string[]));
    const keys: Array<{ path: string; label: string }> = [];
    for (const entry of entries.toSorted()) {
      if (
        entry.endsWith(".pub") ||
        entry === "config" ||
        entry.startsWith("known_hosts") ||
        entry === "authorized_keys"
      ) {
        continue;
      }
      const file = path.join(sshDir, entry);
      const info = yield* fileSystem.stat(file).pipe(Effect.orElseSucceed(() => null));
      if (!info || info.type !== "File") continue;
      const head = yield* fileSystem.readFileString(file).pipe(
        Effect.map((text) => text.slice(0, 64)),
        Effect.orElseSucceed(() => ""),
      );
      if (head.startsWith("-----BEGIN")) keys.push({ path: file, label: entry });
    }
    return keys;
  });
