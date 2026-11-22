import * as NodeServices from "@effect/platform-node/NodeServices";
import { createServer, type ServerResponse, type RequestListener } from "node:http";
import type { Socket } from "node:net";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Deferred, Effect, Layer, ManagedRuntime, Schema, Stream } from "effect";
import {
  ServerSettings,
  decodeComputerActivitySummaryCommand,
  type ComputerActivitySemanticSummary,
} from "@djl/contracts";
import { afterEach, expect, it, vi } from "vitest";
// Cross-app end-to-end composition loads desktop code at runtime; server types stay independent.
const { ComputerActivitySummaries } = await import(
  new URL("../../../desktop/src/computerActivitySummaries.ts", import.meta.url).href
);
import { ServerConfig } from "../config";
import { ServerSettingsService } from "../serverSettings";
import { writeCloudSession } from "../cloud/session";
import { ComputerActivityGenerationLive } from "./Layers/ComputerActivityGeneration";
import { ComputerActivityGeneration } from "./Services/ComputerActivityGeneration";
import { ComputerActivitySummaryWorker } from "./computerActivitySummarization";

vi.mock("./desktopComputerCredentials", () => ({
  desktopComputerCredentials: { url: "", token: "" },
}));
const closes: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const close of closes.splice(0).toReversed()) await close();
});
async function until(check: () => boolean) {
  const end = Date.now() + 2500;
  while (!check()) {
    if (Date.now() > end) throw new Error("Owned pipeline did not advance");
    await new Promise((r) => setTimeout(r, 5));
  }
}
const settings = {
  enabled: true,
  paused: false,
  semanticSummariesEnabled: true,
  interactionCaptureEnabled: false,
  retentionDays: 30,
  intervalSeconds: 30,
  includedBundleIds: ["com.djl.fixture"],
  includedDomains: [],
  excludedBundleIds: [],
  excludedDomains: [],
};
const record = {
  id: "snapshot-fixture",
  capturedAt: "2026-10-28T12:01:00.000Z",
  target: { bundleId: "com.djl.fixture", pid: 42, windowId: 7 },
  appName: "Synthetic fixture",
  windowTitle: "Draft review",
  labels: ["A synthetic draft was reviewed"],
};
async function listen(handler: RequestListener) {
  const sockets = new Set<Socket>();
  const server = createServer(handler);
  server.on("connection", (s) => {
    sockets.add(s);
    s.once("close", () => sockets.delete(s));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  closes.push(async () => {
    for (const s of sockets) s.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}
const chunk = (delta: unknown, finish: string | null = null) => ({
  id: "pipeline-request",
  object: "chat.completion.chunk",
  created: 1,
  model: "pipeline-model",
  choices: [{ index: 0, delta, finish_reason: finish }],
});

const respond = (res: ServerResponse, body: any) => {
  const prompt = body.messages[0].content as string;
  const input = JSON.parse(
    prompt
      .split("BEGIN_UNTRUSTED_ACTIVITY_EVIDENCE_JSON\n")[1]!
      .split("\nEND_UNTRUSTED_ACTIVITY_EVIDENCE_JSON")[0]!,
  );
  const output = {
    title:
      input.periodSeconds === 600 ? "Synthetic ten-minute review" : "Synthetic six-hour review",
    description: "A synthetic draft was reviewed.",
    applications: input.applications,
    memory: "The fixture contains a draft review.",
    recording: "The synthetic draft stayed open.",
    citations: input.sourceIds,
    suggestion: null,
  };
  res.end(
    `data: ${JSON.stringify(chunk({ role: "assistant", content: JSON.stringify(output) }))}\n\ndata: ${JSON.stringify(chunk({}, "stop"))}\n\nevent: djl.usage\ndata: ${JSON.stringify({ requestId: "pipeline-request", model: "pipeline-model", routeReason: "primary", inputTokens: 20, outputTokens: 20, settled: "1", remaining: "100", cutOff: false })}\n\ndata: [DONE]\n\n`,
  );
};

async function setup() {
  const root = await mkdtemp(path.join(os.tmpdir(), "djl-cloud-pipeline-"));
  closes.push(() => rm(root, { recursive: true, force: true }));
  const clock = { now: new Date("2026-10-28T12:10:31.000Z"), evidence: [record] };
  const options = {
    directory: path.join(root, "semantic"),
    settings,
    now: () => clock.now,
    readEvidence: () => clock.evidence,
  };
  let store = new ComputerActivitySummaries(options);
  const requests: any[] = [];
  let held: { response: ServerResponse; body: any } | undefined,
    mode: "normal" | "hold" | "authentication" = "normal",
    bodyClosed = false;
  const endpoint = await listen((req, res) => {
    expect(req.url).toBe("/v1/chat/completions");
    expect(req.headers.authorization).toBe("Bearer pipeline-fixture-token");
    const chunks: Buffer[] = [];
    req.on("data", (b) => chunks.push(b));
    req.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString());
      requests.push(body);
      expect(body.tools).toEqual([]);
      expect(body.tool_choice).toBe("none");
      res.setHeader("content-type", "text/event-stream");
      if (mode === "authentication") {
        res.statusCode = 401;
        res.end("private-provider-error");
      } else if (mode === "hold") {
        held = { response: res, body };
        res.once("close", () => {
          bodyClosed = true;
        });
        res.flushHeaders();
      } else respond(res, body);
    });
  });
  const configured = Schema.decodeUnknownSync(ServerSettings)({
    textGenerationModelSelection: { provider: "djlCloud", model: "pipeline-model" },
    providers: { djlCloud: { enabled: true } },
  });
  const ready = await Effect.runPromise(Deferred.make<void>());
  await Effect.runPromise(Deferred.succeed(ready, undefined));
  const settingsLayer = Layer.succeed(ServerSettingsService, {
    start: Effect.void,
    ready: Deferred.await(ready),
    getConfiguredSettings: Effect.succeed(configured),
    getSettings: Effect.die("No fallback"),
    updateSettings: () => Effect.succeed(configured),
    streamChanges: Stream.empty,
  });
  const configLayer = ServerConfig.layerTest(root, root).pipe(Layer.provide(NodeServices.layer));
  const runtime = ManagedRuntime.make(
    ComputerActivityGenerationLive.pipe(
      Layer.provideMerge(Layer.mergeAll(settingsLayer, configLayer)),
    ),
  );
  closes.push(() => runtime.dispose());
  const config = await runtime.runPromise(Effect.service(ServerConfig));
  await writeCloudSession(config.secretsDir, {
    apiBaseUrl: endpoint,
    token: "pipeline-fixture-token",
    userId: "fixture",
    email: "fixture@example.invalid",
    orgId: "fixture",
    createdAt: record.capturedAt,
  });
  const generation = await runtime.runPromise(Effect.service(ComputerActivityGeneration));
  const commands: string[] = [];
  const host = await listen((req, res) => {
    expect(req.url).toBe("/computer-use/summary-jobs");
    expect(req.headers.authorization).toBe("Bearer pipeline-host-token");
    const chunks: Buffer[] = [];
    req.on("data", (b) => chunks.push(b));
    req.on("end", () => {
      const command = decodeComputerActivitySummaryCommand(
        JSON.parse(Buffer.concat(chunks).toString()),
      );
      commands.push(command.operation);
      let reply: unknown;
      if (command.operation === "claim") reply = { operation: "claim", job: store.claim() };
      else if (command.operation === "valid")
        reply = { operation: "valid", valid: store.valid(command.leaseId) };
      else if (command.operation === "complete")
        reply = {
          operation: "complete",
          accepted: store.complete(command.leaseId, command.content, {
            provider: command.provider,
            model: command.model,
          }),
        };
      else reply = { operation: "fail", accepted: store.fail(command.leaseId, command.code) };
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(reply));
    });
  });
  const makeWorker = () =>
    new ComputerActivitySummaryWorker({
      credentials: { url: host + "/computer-use", token: "pipeline-host-token" },
      now: () => clock.now.getTime(),
      generate: (input) => runtime.runPromise(generation.generate(input)),
    });
  const workers: ComputerActivitySummaryWorker[] = [];
  const worker = makeWorker();
  workers.push(worker);
  closes.push(() => Promise.all(workers.map((w) => w.dispose())));
  return {
    root,
    clock,
    options,
    requests,
    commands,
    worker,
    store: () => store,
    reopen: () => {
      store = new ComputerActivitySummaries(options);
      const worker = makeWorker();
      workers.push(worker);
      return worker;
    },
    failAuthentication: () => {
      mode = "authentication";
    },
    hold: () => {
      mode = "hold";
    },
    held: () => held,
    closed: () => bodyClosed,
    release: () => {
      assertHeld();
      respond(held!.response, held!.body);
    },
  };
  function assertHeld() {
    if (!held) throw new Error("No owned provider response held");
  }
}
it("persists ten-minute and six-hour cloud results with lineage and restart idempotence", async () => {
  const f = await setup();
  await f.worker.runOnce();
  const first = f
    .store()
    .list()
    .summaries.find((s: ComputerActivitySemanticSummary) => s.periodSeconds === 600)!;
  expect(first).toBeDefined();
  expect(first.provider).toBe("djlCloud");
  expect(first.model).toBe("pipeline-model");
  expect(first.content.citations).toEqual(["snapshot-fixture"]);
  await f.worker.dispose();
  const restarted = f.reopen();
  await restarted.runOnce();
  expect(f.requests).toHaveLength(1);
  f.clock.now = new Date("2026-10-28T18:00:31.000Z");
  await restarted.runOnce();
  const rollup = f
    .store()
    .list()
    .summaries.find((s: ComputerActivitySemanticSummary) => s.periodSeconds === 21600)!;
  expect(rollup).toBeDefined();
  expect(rollup.content.citations).toEqual([first.id]);
  expect(rollup.provider).toBe("djlCloud");
  expect(f.requests).toHaveLength(2);
  const persisted = JSON.parse(
    await readFile(path.join(f.options.directory, "semantic-summaries.json"), "utf8"),
  );
  expect(JSON.stringify(persisted)).toContain(first.id);
  expect(JSON.stringify(persisted)).toContain(rollup.id);
  f.clock.evidence = [];
  expect(f.store().clear({ bundleId: "com.djl.fixture" })).toBeGreaterThanOrEqual(2);
  expect(f.store().list().summaries).toEqual([]);
});
it.each(["pause", "disable"])(
  "%s invalidates the real worker lease and aborts held cloud transport",
  async (control) => {
    const f = await setup();
    f.hold();
    const running = f.worker.runOnce();
    await until(() => f.held() !== undefined);
    f.store().configure({
      ...settings,
      ...(control === "pause" ? { paused: true } : { enabled: false }),
    });
    await running;
    await until(f.closed);
    expect(f.store().list().summaries).toEqual([]);
    expect(f.commands).not.toContain("complete");
    expect(f.requests).toHaveLength(1);
  },
);
it("rejects complete cloud output that arrives after pause", async () => {
  const f = await setup();
  f.hold();
  const running = f.worker.runOnce();
  await until(() => f.held() !== undefined);
  f.store().configure({ ...settings, paused: true });
  f.release();
  await running;
  expect(f.store().list().summaries).toEqual([]);
  expect(f.commands).not.toContain("complete");
  expect(f.requests).toHaveLength(1);
});

it("persists a safe provider authentication failure without a summary", async () => {
  const f = await setup();
  f.failAuthentication();
  await f.worker.runOnce();
  expect(f.store().list().status.lastFailure).toBe("authentication");
  expect(f.store().list().summaries).toEqual([]);
  expect(f.requests).toHaveLength(1);
  expect(f.commands).toContain("fail");
  expect(f.commands).not.toContain("complete");
});
it("does not resurrect derived data from a late result after scoped deletion", async () => {
  const f = await setup();
  f.hold();
  const running = f.worker.runOnce();
  await until(() => f.held() !== undefined);
  f.clock.evidence = [];
  f.store().clear({ bundleId: "com.djl.fixture" });
  f.release();
  await running;
  expect(f.store().list().summaries).toEqual([]);
  expect(f.commands).not.toContain("complete");
  expect(f.requests).toHaveLength(1);
});
