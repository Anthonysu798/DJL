import { ThreadId } from "@synara/contracts";
import { describe, expect, it } from "vitest";

import type { NativeDriverFactory, NativeSink } from "../types";
import { openChildSession, type ChildRequestHandler } from "./childSession";

const start = {
  threadId: ThreadId.makeUnsafe("group-thread"),
  cwd: "/tmp",
  runtimeMode: "approval-required" as const,
};
const accept: ChildRequestHandler = async () => "accept";

function fake(
  script: (sink: NativeSink) => Promise<void> | void,
  options: { interrupt?: () => void; id?: string } = {},
): NativeDriverFactory {
  return async (_input, sink) => ({
    id: options.id ?? "native-1",
    send: async () => {
      await script(sink);
    },
    interrupt: async () => options.interrupt?.(),
    close: () => {},
    models: async () => ({ models: [] }),
  });
}

const open = (factory: NativeDriverFactory, provider: "claudeAgent" | "codex" = "claudeAgent") =>
  openChildSession({ provider, factory, start });

const text = (itemId: string, delta: string) => ({
  type: "content.delta",
  itemId,
  payload: { streamKind: "assistant_text", delta },
});

describe("group child session", () => {
  it("returns only the last assistant message", async () => {
    const child = await open(
      fake((sink) => {
        sink.emit(text("a1", "Let me look."));
        sink.emit({
          type: "item.started",
          itemId: "t1",
          payload: { itemType: "dynamic_tool_call" },
        });
        sink.emit({
          type: "content.delta",
          itemId: "r1",
          payload: { streamKind: "reasoning_text", delta: "hmm" },
        });
        sink.emit(text("a2", "The answer "));
        sink.emit(text("a2", "is 4."));
      }),
    );
    expect(child.nativeSessionId).toBe("native-1");
    expect(await child.ask("2+2?", accept)).toEqual({
      status: "ok",
      text: "The answer is 4.",
      work: { files: [], commands: [] },
    });
  });

  it("reports an empty reply", async () => {
    const child = await open(fake(() => {}));
    expect((await child.ask("go", accept)).status).toBe("empty");
  });

  it("turns a child failure into a failed reply without throwing", async () => {
    const child = await open(fake((sink) => sink.fail(new Error("Usage limit reached"))));
    expect(await child.ask("go", accept)).toMatchObject({
      status: "failed",
      error: "Usage limit reached",
    });
  });

  it("turns a rejected send into a failed reply", async () => {
    const child = await open(
      fake(() => {
        throw new Error("CLI crashed");
      }),
    );
    expect(await child.ask("go", accept)).toMatchObject({ status: "failed", error: "CLI crashed" });
  });

  it("records accepted edits and commands, not declined ones", async () => {
    const child = await open(
      fake(async (sink) => {
        await sink.request("file_change_approval", { tool: "Edit", input: { file_path: "a.ts" } });
        await sink.request("command_execution_approval", {
          tool: "Bash",
          input: { command: "ls" },
        });
        sink.emit(text("a", "done"));
      }),
    );
    const reply = await child.ask("go", async (type) =>
      type === "file_change_approval" ? "accept" : "decline",
    );
    expect(reply.work.files).toHaveLength(1);
    expect(reply.work.files[0]).toContain("a.ts");
    expect(reply.work.commands).toEqual([]);
  });

  it("counts Codex work from completed items, not from requests", async () => {
    const child = await open(
      fake(async (sink) => {
        await sink.request("file_change_approval", { item: { changes: [{ path: "a.ts" }] } });
        sink.emit({
          type: "item.completed",
          itemId: "f1",
          payload: { itemType: "file_change", title: "Edited a.ts" },
        });
        sink.emit({
          type: "item.completed",
          itemId: "c1",
          payload: { itemType: "command_execution", title: "bun test" },
        });
        sink.emit(text("a", "done"));
      }),
      "codex",
    );
    expect((await child.ask("go", accept)).work).toEqual({
      files: ["Edited a.ts"],
      commands: ["bun test"],
    });
  });

  it("reads Codex work from the item data the real driver sends", async () => {
    const child = await open(
      fake(async (sink) => {
        sink.emit({
          type: "item.completed",
          itemId: "f1",
          payload: {
            itemType: "file_change",
            status: "completed",
            data: { type: "fileChange", changes: [{ path: "/g/a.txt" }, { path: "/g/b.txt" }] },
          },
        });
        sink.emit({
          type: "item.completed",
          itemId: "f2",
          payload: {
            itemType: "file_change",
            status: "declined",
            data: { type: "fileChange", changes: [{ path: "/g/never.txt" }] },
          },
        });
        sink.emit({
          type: "item.completed",
          itemId: "c1",
          payload: {
            itemType: "command_execution",
            status: "completed",
            data: { type: "commandExecution", command: "bun test" },
          },
        });
        sink.emit(text("a", "done"));
      }),
      "codex",
    );
    expect((await child.ask("go", accept)).work).toEqual({
      files: ["/g/a.txt", "/g/b.txt"],
      commands: ["bun test"],
    });
  });

  it("stop resolves the pending ask as stopped", async () => {
    const hung = Promise.withResolvers<void>();
    const child = await open(fake(() => hung.promise, { interrupt: () => hung.resolve() }));
    const pending = child.ask("go", accept);
    await child.stop();
    expect((await pending).status).toBe("stopped");
  });

  it("starts every child in approval-required mode without OS sandbox options", async () => {
    const seen: unknown[] = [];
    const factory: NativeDriverFactory = async (input, sink) => {
      seen.push(input);
      return fake(() => {})(input, sink);
    };
    await openChildSession({
      provider: "claudeAgent",
      factory,
      start: { ...start, runtimeMode: "full-access" },
    });
    expect(seen[0]).toMatchObject({ runtimeMode: "approval-required" });
    expect(seen[0]).not.toHaveProperty("sandboxMode");
    expect(seen[0]).not.toHaveProperty("approvalPolicy");
  });
});
