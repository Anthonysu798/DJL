import { it, assert } from "@effect/vitest";
import { Effect } from "effect";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite";
import { saveDocument } from "./store";
import { recoverJobs } from "./jobs";
it.layer(SqlitePersistenceMemory)("export recovery", (it) => {
  it.effect("marks an orphaned render interrupted instead of successful", () =>
    Effect.gen(function* () {
      yield* saveDocument(
        "job",
        "orphan",
        { id: "orphan", status: "rendering", progress: 42 },
        null,
      );
      const jobs = yield* recoverJobs();
      assert.strictEqual((jobs[0]!.value as { status: string }).status, "interrupted");
    }),
  );
});
