import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  LocalModelsSnapshot,
  type LocalModelsSnapshot as LocalModelsSnapshotValue,
} from "@synara/contracts";
import { Schema } from "effect";

export class LocalModelSnapshotCache {
  readonly #path: string;
  #write = Promise.resolve();

  constructor(stateDir: string) {
    this.#path = join(stateDir, "local-models", "snapshot-v1.json");
  }

  async load(): Promise<LocalModelsSnapshotValue | null> {
    try {
      return Schema.decodeUnknownSync(LocalModelsSnapshot)(
        JSON.parse(await readFile(this.#path, "utf8")) as unknown,
      );
    } catch {
      return null;
    }
  }

  async save(snapshot: LocalModelsSnapshotValue): Promise<void> {
    const payload = `${JSON.stringify(snapshot, null, 2)}\n`;
    this.#write = this.#write
      .catch(() => undefined)
      .then(async () => {
        await mkdir(dirname(this.#path), { recursive: true, mode: 0o700 });
        const temporaryPath = `${this.#path}.${process.pid}.${Date.now()}.tmp`;
        await writeFile(temporaryPath, payload, { mode: 0o600 });
        await rename(temporaryPath, this.#path);
      });
    await this.#write;
  }
}
