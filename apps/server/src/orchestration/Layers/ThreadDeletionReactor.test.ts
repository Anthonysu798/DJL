import { ThreadId } from "@synara/contracts";
import { Cause, Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";

import {
  cleanupSucceededUnlessInterrupted,
  logCleanupCauseUnlessInterrupted,
  prepareThreadForPurge,
} from "./ThreadDeletionReactor";

describe("logCleanupCauseUnlessInterrupted", () => {
  const threadId = ThreadId.makeUnsafe("thread-deletion-reactor-test");

  it("swallows ordinary cleanup failures", async () => {
    const exit = await Effect.runPromiseExit(
      logCleanupCauseUnlessInterrupted({
        effect: Effect.fail("cleanup failed"),
        message: "thread deletion cleanup skipped provider session stop",
        threadId,
      }),
    );

    expect(Exit.isSuccess(exit)).toBe(true);
  });

  it("preserves interrupt causes", async () => {
    const exit = await Effect.runPromiseExit(
      logCleanupCauseUnlessInterrupted({
        effect: Effect.interrupt,
        message: "thread deletion cleanup skipped provider session stop",
        threadId,
      }),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.hasInterruptsOnly(exit.cause)).toBe(true);
    }
  });
});

describe("cleanupSucceededUnlessInterrupted", () => {
  const threadId = ThreadId.makeUnsafe("thread-deletion-reactor-test");

  it("returns true for successful cleanup", async () => {
    const result = await Effect.runPromise(
      cleanupSucceededUnlessInterrupted({
        effect: Effect.void,
        message: "thread deletion cleanup skipped provider session stop",
        threadId,
      }),
    );

    expect(result).toBe(true);
  });

  it("returns false for ordinary cleanup failures", async () => {
    const result = await Effect.runPromise(
      cleanupSucceededUnlessInterrupted({
        effect: Effect.fail("cleanup failed"),
        message: "thread deletion cleanup skipped provider session stop",
        threadId,
      }),
    );

    expect(result).toBe(false);
  });

  it("preserves interrupt causes", async () => {
    const exit = await Effect.runPromiseExit(
      cleanupSucceededUnlessInterrupted({
        effect: Effect.interrupt,
        message: "thread deletion cleanup skipped provider session stop",
        threadId,
      }),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.hasInterruptsOnly(exit.cause)).toBe(true);
    }
  });
});

describe("prepareThreadForPurge", () => {
  it("removes the handoff archive after runtime cleanup and before allowing purge", async () => {
    const order: string[] = [];
    const ready = await Effect.runPromise(
      prepareThreadForPurge({
        cleanup: Effect.sync(() => {
          order.push("runtime-cleanup");
          return true;
        }),
        removeArchive: Effect.sync(() => {
          order.push("archive-removal");
          return true;
        }),
      }),
    );

    expect(ready).toBe(true);
    expect(order).toEqual(["runtime-cleanup", "archive-removal"]);
  });

  it("blocks purge when archive removal fails", async () => {
    await expect(
      Effect.runPromise(
        prepareThreadForPurge({
          cleanup: Effect.succeed(true),
          removeArchive: Effect.succeed(false),
        }),
      ),
    ).resolves.toBe(false);
  });
});
