import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { containerArgs } from "../../apps/api/src/agent/codex/broker.ts";

const network = process.env.CODEX_TEST_NETWORK ?? "djl-codex-protocol";
const runId = crypto.randomUUID();
const args = containerArgs(runId, "djl-codex:0.125.0", network);
const child = spawn("docker", args, { stdio: ["pipe", "pipe", "pipe"] });
let nextId = 0;
let completed = false;
let toolCompleted = false;
const pending = new Map<
  number,
  { resolve: (value: Record<string, unknown>) => void; reject: (error: unknown) => void }
>();
const rpc = (method: string, params: unknown = {}) =>
  new Promise<Record<string, unknown>>((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
  });
const done = Promise.withResolvers<void>();
const timeout = setTimeout(() => done.reject(new Error("Codex protocol smoke timed out")), 30_000);
child.stderr.on("data", (data) => process.stderr.write(data));
createInterface({ input: child.stdout }).on("line", (line) => {
  const frame = JSON.parse(line);
  if (frame.id !== undefined && !frame.method) {
    const p = pending.get(frame.id);
    pending.delete(frame.id);
    if (frame.error) p?.reject(new Error(JSON.stringify(frame.error)));
    else p?.resolve(frame.result);
  }
  if (frame.method === "item/completed" && frame.params.item.type === "commandExecution")
    toolCompleted = true;
  if (frame.method === "turn/completed") {
    completed = frame.params.turn.status === "completed";
    if (completed) done.resolve();
    else done.reject(new Error("Codex turn failed"));
  }
  if (frame.method === "error") done.reject(new Error("Codex returned a protocol error"));
});
child.on("error", done.reject);
child.stdin.write(
  `${JSON.stringify({ model: "gpt-5", token: "protocol-test-not-a-real-key", gatewayUrl: "http://codex-broker:8090/v1" })}\n`,
);
try {
  await rpc("initialize", {
    clientInfo: { name: "djl_protocol_test", version: "0.1.0" },
    capabilities: {},
  });
  child.stdin.write(`${JSON.stringify({ method: "initialized" })}\n`);
  const thread = await rpc("thread/start", {
    model: "gpt-5",
    modelProvider: "djl",
    cwd: "/workspace",
    approvalPolicy: "never",
    sandbox: "danger-full-access",
  });
  await rpc("turn/start", {
    threadId: (thread.thread as { id: string }).id,
    input: [
      {
        type: "text",
        text: "Run printf DJL_CODEX_TOOL_OK in the isolated workspace, then answer DJL_CODEX_PROTOCOL_OK.",
        text_elements: [],
      },
    ],
  });
  await done.promise;
  if (!completed || !toolCompleted) throw new Error("Codex did not complete the tool round trip");
  console.log(
    "Pinned Codex App Server: initialize, thread/start, turn/start, command tool round trip, and turn completion passed.",
  );
} finally {
  clearTimeout(timeout);
  const remove = Bun.spawn(["docker", "rm", "-f", `djl-codex-${runId}`], {
    stdout: "ignore",
    stderr: "ignore",
  });
  await remove.exited;
  child.kill();
  await Bun.spawn(["docker", "volume", "rm", `djl-codex-${runId}`], {
    stdout: "ignore",
    stderr: "ignore",
  }).exited;
}
