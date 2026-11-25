import type { GroupMemberProvider } from "@djl/contracts";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { NativeDriverFactory, NativeSink } from "../types";
import { LENT_AGENT_GUARD, createLentAgents } from "./lentAgent";

let root: string;
let prompts: string[];
let starts: { cwd: string | undefined; model: string | undefined; runtimeMode: string }[];
let closed: number;
let decisions: unknown[];
/** What the fake CLI does on each turn. */
let behave: (sink: NativeSink, cwd: string) => Promise<string>;

const factory: NativeDriverFactory = async (input, sink) => {
  starts.push({
    cwd: input.cwd,
    model: input.modelSelection?.model,
    runtimeMode: input.runtimeMode,
  });
  return {
    id: `native-${starts.length}`,
    async send(turn) {
      prompts.push(turn.input ?? "");
      const text = await behave(sink, input.cwd!);
      sink.emit({
        type: "content.delta",
        itemId: "a1",
        payload: { streamKind: "assistant_text", delta: text },
      });
    },
    async interrupt() {},
    close() {
      closed += 1;
    },
    models: async () => ({ models: [] }),
  };
};

const agents = (idleCloseMs?: number) =>
  createLentAgents({
    childFactories: new Proxy({}, { get: () => factory }) as Record<
      GroupMemberProvider,
      NativeDriverFactory
    >,
    childOptions: async () => ({}),
    workRoot: root,
    ...(idleCloseMs === undefined ? {} : { idleCloseMs }),
  });
const ask = (lent: ReturnType<typeof agents>, sessionId: string, model: string | null = null) =>
  lent.ask(
    { linkId: "link00001", sessionId, provider: "codex", model, prompt: "@Bo hi" },
    () => {},
  );

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "djl-lent-"));
  prompts = [];
  starts = [];
  closed = 0;
  decisions = [];
  behave = async () => "hello";
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("lent agent", () => {
  it("answers in an empty folder of its own, behind the visitor rules", async () => {
    const lent = agents();
    const sessionId = lent.open("link00001");
    expect(await ask(lent, sessionId)).toEqual({ status: "ok", text: "hello" });
    expect(starts).toEqual([
      { cwd: join(root, "link00001"), model: undefined, runtimeMode: "approval-required" },
    ]);
    expect(readdirSync(join(root, "link00001"))).toEqual([]);
    expect(prompts[0]!.startsWith(LENT_AGENT_GUARD)).toBe(true);
    expect(prompts[0]!.endsWith("@Bo hi")).toBe(true);
    lent.close("link00001");
  });

  it("refuses every command, file change and read outside its folder", async () => {
    behave = async (sink, cwd) => {
      decisions.push(
        await sink.request("command_execution_approval", { command: "cat ~/.ssh/id_rsa" }),
        await sink.request("file_change_approval", { path: join(cwd, "x.txt") }),
        await sink.request("file_read_approval", { path: "/etc/passwd" }),
      );
      return "done";
    };
    const lent = agents();
    await ask(lent, lent.open("link00001"));
    expect(decisions).toEqual(["decline", "decline", "decline"]);
    lent.close("link00001");
  });

  it("keeps one session per link and reuses its CLI", async () => {
    const lent = agents();
    const sessionId = lent.open("link00001");
    expect(lent.open("link00001")).toBe(sessionId);
    await ask(lent, sessionId);
    await ask(lent, sessionId);
    expect(starts).toHaveLength(1);
    lent.close("link00001");
    expect(closed).toBe(1);
    // Closed: the next open is a new session, so the group briefs the agent again.
    expect(lent.open("link00001")).not.toBe(sessionId);
  });

  it("refuses a turn for a session it no longer has", async () => {
    const lent = agents();
    lent.open("link00001");
    expect(await ask(lent, "an-old-session")).toMatchObject({ status: "failed" });
    expect(starts).toHaveLength(0);
  });

  it("starts a new CLI when the model changes", async () => {
    const lent = agents();
    const sessionId = lent.open("link00001");
    await ask(lent, sessionId, "model-a");
    await ask(lent, sessionId, "model-b");
    expect(starts.map((start) => start.model)).toEqual(["model-a", "model-b"]);
    expect(closed).toBe(1);
    lent.close("link00001");
  });

  it("reports a failing CLI and starts a new session afterwards", async () => {
    behave = async (sink) => {
      sink.fail(new Error("not signed in"));
      return "";
    };
    const lent = agents();
    const sessionId = lent.open("link00001");
    expect(await ask(lent, sessionId)).toEqual({ status: "failed", text: "not signed in" });
    expect(lent.open("link00001")).not.toBe(sessionId);
  });

  it("closes an idle agent's CLI", async () => {
    const lent = agents(5);
    const sessionId = lent.open("link00001");
    await ask(lent, sessionId);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(closed).toBe(1);
    expect(lent.open("link00001")).not.toBe(sessionId);
    expect(existsSync(join(root, "link00001"))).toBe(true);
  });
});
