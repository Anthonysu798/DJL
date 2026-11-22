import * as NodeServices from "@effect/platform-node/NodeServices";
import { createServer } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { Deferred, Effect, Fiber, Layer, ManagedRuntime, Schema, Stream } from "effect";
import { ServerSettings } from "@djl/contracts";
import type { ComputerActivitySummaryJob } from "@djl/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ServerSettingsService } from "../../serverSettings";
import { ServerConfig } from "../../config";
import { generateActivityDjlCloudSummary } from "../activityDjlCloudGeneration";
import { generateActivityCodexResponsesSummary } from "../activityCodexResponsesGeneration";
import { ComputerActivityGenerationError } from "../computerActivitySummarization";
import { ComputerActivityGeneration } from "../Services/ComputerActivityGeneration";
import { ComputerActivityGenerationLive } from "./ComputerActivityGeneration";

const credentials = vi.hoisted(() => ({ url: "", token: "" }));
vi.mock("../desktopComputerCredentials", () => ({ desktopComputerCredentials: credentials }));
vi.mock("../activityCodexResponsesGeneration", () => ({
  generateActivityCodexResponsesSummary: vi.fn(),
}));
vi.mock("../activityDjlCloudGeneration", () => ({ generateActivityDjlCloudSummary: vi.fn() }));
const runtimes: Array<{ dispose: () => Promise<void> }> = [];
const content = {
  title: "Fixture decision",
  description: "A synthetic draft was reviewed.",
  applications: ["com.djl.fixture"],
  memory: "The draft requires review.",
  recording: "A draft remained open.",
  citations: ["event-a"],
};
const evidence = {
  startedAt: "2026-10-28T12:00:00.000Z",
  endedAt: "2026-10-28T12:10:00.000Z",
  periodSeconds: 600 as const,
  sourceIds: ["event-a"],
  applications: ["com.djl.fixture"],
  omittedRecordCount: 0,
  material: "Synthetic fixture only",
  previousSummaries: [],
};
const request = () => ({ evidence, signal: new AbortController().signal });
const decodeSettings = Schema.decodeUnknownSync(ServerSettings);
function settings() {
  return decodeSettings({
    textGenerationModelSelection: {
      provider: "codex",
      model: "fixture-a",
      options: { reasoningEffort: "high", fastMode: true },
    },
    providers: { codex: { homePath: "/private/tmp/djl-service-fixture-home" } },
  });
}
async function fixture(initiallyReady = true, configuredGate?: Promise<void>) {
  let current = settings();
  const ready = await Effect.runPromise(Deferred.make<void>());
  if (initiallyReady) await Effect.runPromise(Deferred.succeed(ready, undefined));
  const configured = vi.fn(() => current);
  const fallback = vi.fn(() =>
    decodeSettings({
      textGenerationModelSelection: { provider: "opencode", model: "other/fallback" },
    }),
  );
  const layer = Layer.succeed(ServerSettingsService, {
    start: Deferred.succeed(ready, undefined).pipe(Effect.asVoid),
    ready: Deferred.await(ready),
    getConfiguredSettings: Deferred.await(ready).pipe(
      Effect.andThen(Effect.promise(() => configuredGate ?? Promise.resolve())),
      Effect.andThen(Effect.sync(configured)),
    ),
    getSettings: Effect.sync(fallback),
    updateSettings: () => Effect.sync(() => current),
    streamChanges: Stream.empty,
  });
  const config = ServerConfig.layerTest("/private/tmp/djl-generation-fixture", {
    prefix: "djl-generation-cloud-",
  }).pipe(Layer.provide(NodeServices.layer));
  const runtime = ManagedRuntime.make(
    ComputerActivityGenerationLive.pipe(Layer.provide(Layer.mergeAll(layer, config))),
  );
  runtimes.push(runtime);
  const generate = (input = request()) =>
    runtime.runPromise(
      Effect.flatMap(Effect.service(ComputerActivityGeneration), (service) =>
        service.generate(input),
      ),
    );
  return {
    runtime,
    generate,
    configured,
    fallback,
    replace: (value: ServerSettings) => {
      current = value;
    },
    ready: () => Effect.runPromise(Deferred.succeed(ready, undefined)),
  };
}
async function until(predicate: () => boolean) {
  const deadline = performance.now() + 1000;
  while (!predicate()) {
    if (performance.now() >= deadline) throw new Error("Owned service fixture did not advance");
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}
const hosts: Array<() => Promise<void>> = [];
async function host(job: ComputerActivitySummaryJob | null = null, hold?: string) {
  credentials.token = "private-fixture-host-token";
  const commands: Array<Record<string, unknown>> = [];
  const sockets = new Set<Socket>();
  const fetch = vi.fn();
  const server = createServer((request, response) => {
    fetch();
    expect(request.url).toBe("/computer-use/summary-jobs");
    expect(request.headers.authorization).toBe("Bearer private-fixture-host-token");
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const command = JSON.parse(Buffer.concat(chunks).toString());
      commands.push(command);
      if (command.operation === hold) return;
      response.end(
        JSON.stringify(
          command.operation === "claim"
            ? { operation: "claim", job }
            : command.operation === "valid"
              ? { operation: "valid", valid: true }
              : { operation: command.operation, accepted: true },
        ),
      );
    });
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  credentials.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/computer-use`;
  hosts.push(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  return { commands, fetch, sockets };
}
function liveJob(): ComputerActivitySummaryJob {
  const end = Math.floor(Date.now() / 1000) * 1000 - 1000;
  return {
    ...evidence,
    id: "job-private",
    leaseId: "lease-private",
    generation: "generation-private",
    sourceFingerprint: "a".repeat(64),
    startedAt: new Date(end - 600000).toISOString(),
    endedAt: new Date(end).toISOString(),
    expiresAt: new Date(Date.now() + 180000).toISOString(),
  };
}
beforeEach(() => {
  credentials.url = credentials.token = "";
  vi.mocked(generateActivityDjlCloudSummary)
    .mockReset()
    .mockImplementation(async (input) => ({ provider: "djlCloud", model: input.model, content }));
  vi.mocked(generateActivityCodexResponsesSummary)
    .mockReset()
    .mockImplementation(async (input) => ({ provider: "codex", model: input.model, content }));
});
afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.dispose()));
  await Promise.all(hosts.splice(0).map((close) => close()));
  vi.unstubAllGlobals();
});

describe("dedicated computer activity generation", () => {
  it("uses the fresh saved selection, exact options/home and no generic provider fallback", async () => {
    const f = await fixture();
    expect(await f.generate()).toMatchObject({ provider: "codex", model: "fixture-a" });
    expect(generateActivityCodexResponsesSummary).toHaveBeenLastCalledWith(
      expect.objectContaining({
        model: "fixture-a",
        options: { reasoningEffort: "high", fastMode: true },
        homePath: "/private/tmp/djl-service-fixture-home",
        evidence,
      }),
    );
    f.replace(
      decodeSettings({
        textGenerationModelSelection: {
          provider: "codex",
          model: "fixture-b",
          options: { fastMode: false },
        },
      }),
    );
    expect(await f.generate()).toMatchObject({ model: "fixture-b" });
    expect(f.configured).toHaveBeenCalledTimes(2);
    expect(f.fallback).not.toHaveBeenCalled();
  });
  it.each(["opencode", "cursor", "kilo"])("keeps unsupported %s cold", async (provider) => {
    const f = await fixture();
    f.replace(
      decodeSettings({ textGenerationModelSelection: { provider, model: "fixture-other" } }),
    );
    await expect(f.generate()).rejects.toMatchObject({
      code: "provider-unavailable",
      message: "provider-unavailable",
    });
    expect(generateActivityCodexResponsesSummary).not.toHaveBeenCalled();
    expect(f.fallback).not.toHaveBeenCalled();
  });
  it("rejects disabled selected Codex before any adapter access", async () => {
    const f = await fixture();
    f.replace(decodeSettings({ ...settings(), providers: { codex: { enabled: false } } }));
    await expect(f.generate()).rejects.toMatchObject({ code: "provider-unavailable" });
    expect(generateActivityCodexResponsesSummary).not.toHaveBeenCalled();
  });
  it("sanitizes settings failures without using generic defaults", async () => {
    const f = await fixture();
    f.configured.mockImplementation(() => {
      throw new Error("private settings path");
    });
    await expect(f.generate()).rejects.toMatchObject({
      code: "provider-unavailable",
      message: "provider-unavailable",
    });
    expect(f.fallback).not.toHaveBeenCalled();
    expect(generateActivityCodexResponsesSummary).not.toHaveBeenCalled();
  });
  it("preserves fixed provider errors and sanitizes generic exceptions", async () => {
    const f = await fixture();
    vi.mocked(generateActivityCodexResponsesSummary)
      .mockRejectedValueOnce(new ComputerActivityGenerationError("authentication"))
      .mockRejectedValueOnce(new Error("private provider response"));
    await expect(f.generate()).rejects.toMatchObject({
      code: "authentication",
      message: "authentication",
    });
    await expect(f.generate()).rejects.toMatchObject({
      code: "generation-failed",
      message: "generation-failed",
    });
  });
  it("does not read settings or invoke the provider for pre-cancelled work", async () => {
    const f = await fixture();
    const controller = new AbortController();
    controller.abort();
    await expect(f.generate({ evidence, signal: controller.signal })).rejects.toMatchObject({
      code: "generation-failed",
    });
    expect(f.configured).not.toHaveBeenCalled();
    expect(generateActivityCodexResponsesSummary).not.toHaveBeenCalled();
  });
  it("keeps a desktop-free layer cold and disposes before readiness", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const f = await fixture(false);
    await f.runtime.runPromise(Effect.service(ComputerActivityGeneration));
    await f.runtime.dispose();
    expect(fetch).not.toHaveBeenCalled();
    expect(f.configured).not.toHaveBeenCalled();
    expect(generateActivityCodexResponsesSummary).not.toHaveBeenCalled();
  });
  it("acquires before readiness, then polls an empty host queue without reading provider state", async () => {
    const h = await host();
    const f = await fixture(false);
    await f.runtime.runPromise(Effect.service(ComputerActivityGeneration));
    expect(h.fetch).not.toHaveBeenCalled();
    await f.ready();
    await until(() => h.commands.length === 1);
    expect(h.commands).toEqual([{ operation: "claim" }]);
    expect(f.configured).not.toHaveBeenCalled();
    expect(generateActivityCodexResponsesSummary).not.toHaveBeenCalled();
  });
  it("cancels desktop startup before readiness without a late poll", async () => {
    const h = await host();
    const f = await fixture(false);
    await f.runtime.runPromise(Effect.service(ComputerActivityGeneration));
    await f.runtime.dispose();
    await f.ready();
    await new Promise((resolve) => setTimeout(resolve, 1));
    expect(h.fetch).not.toHaveBeenCalled();
    expect(f.configured).not.toHaveBeenCalled();
  });
  it("does not poll with malformed partial host authority", async () => {
    const h = await host();
    credentials.token = "";
    const f = await fixture();
    await f.runtime.runPromise(Effect.service(ComputerActivityGeneration));
    expect(h.fetch).not.toHaveBeenCalled();
    expect(f.configured).not.toHaveBeenCalled();
  });
  it("passes only stripped evidence through the captured service runner and completes a claimed job", async () => {
    const h = await host(liveJob());
    const f = await fixture();
    await f.runtime.runPromise(Effect.service(ComputerActivityGeneration));
    await until(() => h.commands.some((command) => command.operation === "complete"));
    expect(generateActivityCodexResponsesSummary).toHaveBeenCalledOnce();
    const input = vi.mocked(generateActivityCodexResponsesSummary).mock.calls[0]![0];
    for (const field of ["id", "leaseId", "generation", "expiresAt", "sourceFingerprint"])
      expect(Object.hasOwn(input.evidence, field)).toBe(false);
    expect(JSON.stringify(input.evidence)).not.toContain(credentials.token);
    expect(h.commands.find((command) => command.operation === "complete")).toMatchObject({
      provider: "codex",
      model: "fixture-a",
      content,
    });
  });
  it("scope disposal aborts generation and awaits provider cleanup before returning", async () => {
    const h = await host(liveJob());
    let aborted = false;
    let release!: () => void;
    const cleanup = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.mocked(generateActivityCodexResponsesSummary).mockImplementation(
      ({ signal }) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener(
            "abort",
            () => {
              aborted = true;
              void cleanup.then(() =>
                reject(new ComputerActivityGenerationError("generation-failed")),
              );
            },
            { once: true },
          ),
        ),
    );
    const f = await fixture();
    await f.runtime.runPromise(Effect.service(ComputerActivityGeneration));
    await until(() => vi.mocked(generateActivityCodexResponsesSummary).mock.calls.length === 1);
    let disposed = false;
    const closing = f.runtime.dispose().then(() => {
      disposed = true;
    });
    try {
      await until(() => aborted);
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(disposed).toBe(false);
    } finally {
      release();
      await closing;
    }
    expect(h.commands.some((command) => command.operation === "complete")).toBe(false);
  });
  it("Effect interruption also awaits the direct operation's terminal cleanup", async () => {
    let aborted = false;
    let release!: () => void;
    const cleanup = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.mocked(generateActivityCodexResponsesSummary).mockImplementation(
      ({ signal }) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener(
            "abort",
            () => {
              aborted = true;
              void cleanup.then(() =>
                reject(new ComputerActivityGenerationError("generation-failed")),
              );
            },
            { once: true },
          ),
        ),
    );
    const f = await fixture();
    const service = await f.runtime.runPromise(Effect.service(ComputerActivityGeneration));
    const fiber = f.runtime.runFork(service.generate(request()));
    await until(() => vi.mocked(generateActivityCodexResponsesSummary).mock.calls.length === 1);
    let interrupted = false;
    const closing = Effect.runPromise(Fiber.interrupt(fiber)).then(() => {
      interrupted = true;
    });
    try {
      await until(() => aborted);
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(interrupted).toBe(false);
    } finally {
      release();
      await closing;
    }
  });
  it("discards a valid late result after shutdown and still waits for its operation", async () => {
    const h = await host(liveJob());
    let finish!: () => void;
    vi.mocked(generateActivityCodexResponsesSummary).mockImplementation(
      (input) =>
        new Promise((resolve) => {
          finish = () => resolve({ provider: "codex", model: input.model, content });
        }),
    );
    const f = await fixture();
    await f.runtime.runPromise(Effect.service(ComputerActivityGeneration));
    await until(() => vi.mocked(generateActivityCodexResponsesSummary).mock.calls.length === 1);
    let disposed = false;
    const closing = f.runtime.dispose().then(() => {
      disposed = true;
    });
    try {
      await until(
        () => vi.mocked(generateActivityCodexResponsesSummary).mock.calls[0]![0].signal.aborted,
      );
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(disposed).toBe(false);
    } finally {
      finish();
      await closing;
    }
    expect(h.commands.some((command) => command.operation === "complete")).toBe(false);
  });
  it("denies captured service admission after closure before reading settings", async () => {
    const f = await fixture();
    const service = await f.runtime.runPromise(Effect.service(ComputerActivityGeneration));
    await Promise.all([f.runtime.dispose(), f.runtime.dispose()]);
    await expect(Effect.runPromise(service.generate(request()))).rejects.toMatchObject({
      code: "generation-failed",
    });
    expect(f.configured).not.toHaveBeenCalled();
    expect(generateActivityCodexResponsesSummary).not.toHaveBeenCalled();
  });
  it("fences a configured-settings result held across scope shutdown", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const f = await fixture(true, gate);
    const service = await f.runtime.runPromise(Effect.service(ComputerActivityGeneration));
    const generating = Effect.runPromise(service.generate(request()));
    const rejected = expect(generating).rejects.toMatchObject({ code: "generation-failed" });
    await new Promise<void>((resolve) => setImmediate(resolve));
    try {
      await f.runtime.dispose();
    } finally {
      release();
    }
    await rejected;
    expect(generateActivityCodexResponsesSummary).not.toHaveBeenCalled();
  });
  it("joins every concrete operation without a desktop worker, including late success and failure", async () => {
    const releases: Array<() => void> = [];
    vi.mocked(generateActivityCodexResponsesSummary).mockImplementation(
      (input) =>
        new Promise((resolve, reject) => {
          const index = releases.length;
          releases.push(() =>
            index === 0
              ? resolve({ provider: "codex", model: input.model, content })
              : reject(new Error("private failure")),
          );
        }),
    );
    const f = await fixture();
    const service = await f.runtime.runPromise(Effect.service(ComputerActivityGeneration));
    const operations = [0, 1].map(() => Effect.runPromise(service.generate(request())));
    const results = Promise.allSettled(operations);
    await until(() => releases.length === 2);
    let disposed = false;
    const closing = Promise.all([f.runtime.dispose(), f.runtime.dispose()]).then(() => {
      disposed = true;
    });
    try {
      await until(() =>
        vi
          .mocked(generateActivityCodexResponsesSummary)
          .mock.calls.every(([input]) => input.signal.aborted),
      );
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(disposed).toBe(false);
      releases[0]!();
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(disposed).toBe(false);
    } finally {
      releases.forEach((release) => release());
      await closing;
    }
    expect((await results).every((result) => result.status === "rejected")).toBe(true);
  });
  it.each(["claim", "valid"])(
    "scope disposal retires an actual pending private %s socket",
    async (operation) => {
      const h = await host(liveJob(), operation);
      const f = await fixture();
      await f.runtime.runPromise(Effect.service(ComputerActivityGeneration));
      await until(() => h.commands.some((command) => command.operation === operation));
      await f.runtime.dispose();
      await until(() => h.sockets.size === 0);
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(h.sockets.size).toBe(0);
      expect(h.commands.some((command) => command.operation === "complete")).toBe(false);
      expect(generateActivityCodexResponsesSummary).not.toHaveBeenCalled();
    },
  );
  it("sanitizes synchronous concrete invocation throws and retires normal success/failure", async () => {
    const f = await fixture();
    vi.mocked(generateActivityCodexResponsesSummary).mockImplementationOnce(() => {
      throw new Error("private sync throw");
    });
    await expect(f.generate()).rejects.toMatchObject({ code: "generation-failed" });
    await expect(f.generate()).resolves.toMatchObject({ model: "fixture-a" });
    vi.mocked(generateActivityCodexResponsesSummary).mockRejectedValueOnce(
      new Error("private failure"),
    );
    await expect(f.generate()).rejects.toMatchObject({ code: "generation-failed" });
    await f.runtime.dispose();
  });
});

it("routes an enabled configured DJL Cloud selection to its dedicated tool-free adapter", async () => {
  const f = await fixture();
  f.replace(
    decodeSettings({
      textGenerationModelSelection: { provider: "djlCloud", model: "fixture-cloud" },
      providers: { djlCloud: { enabled: true } },
    }),
  );
  vi.mocked(generateActivityDjlCloudSummary).mockResolvedValue({
    provider: "djlCloud",
    model: "fixture-cloud",
    content,
  });
  expect(await f.generate()).toEqual({ provider: "djlCloud", model: "fixture-cloud", content });
  expect(generateActivityDjlCloudSummary).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      evidence,
      model: "fixture-cloud",
      secretsDir: expect.stringContaining("djl-generation-cloud-"),
      signal: expect.any(AbortSignal),
    }),
  );
  expect(generateActivityCodexResponsesSummary).not.toHaveBeenCalled();
  expect(f.fallback).not.toHaveBeenCalled();
});

it("keeps disabled DJL Cloud cold without Codex fallback", async () => {
  const f = await fixture();
  f.replace(
    decodeSettings({
      textGenerationModelSelection: { provider: "djlCloud", model: "fixture-cloud" },
      providers: { djlCloud: { enabled: false } },
    }),
  );
  await expect(f.generate()).rejects.toMatchObject({ code: "provider-unavailable" });
  expect(generateActivityDjlCloudSummary).not.toHaveBeenCalled();
  expect(generateActivityCodexResponsesSummary).not.toHaveBeenCalled();
});
it("re-reads a switch from Codex to DJL Cloud for the next generation", async () => {
  const f = await fixture();
  expect(await f.generate()).toMatchObject({ provider: "codex", model: "fixture-a" });
  f.replace(
    decodeSettings({
      textGenerationModelSelection: { provider: "djlCloud", model: "fixture-cloud" },
      providers: { djlCloud: { enabled: true } },
    }),
  );
  expect(await f.generate()).toMatchObject({ provider: "djlCloud", model: "fixture-cloud" });
  expect(generateActivityCodexResponsesSummary).toHaveBeenCalledTimes(1);
  expect(generateActivityDjlCloudSummary).toHaveBeenCalledTimes(1);
  expect(f.fallback).not.toHaveBeenCalled();
});
it("retires concrete DJL Cloud work before layer disposal completes", async () => {
  const f = await fixture();
  f.replace(
    decodeSettings({
      textGenerationModelSelection: { provider: "djlCloud", model: "fixture-cloud" },
      providers: { djlCloud: { enabled: true } },
    }),
  );
  let release!: () => void, signal: AbortSignal | undefined;
  vi.mocked(generateActivityDjlCloudSummary).mockImplementation((input) => {
    signal = input.signal;
    return new Promise((resolve) => {
      release = () => resolve({ provider: "djlCloud", model: input.model, content });
    });
  });
  const generating = f.generate();
  const rejected = expect(generating).rejects.toMatchObject({ code: "generation-failed" });
  await until(() => signal !== undefined);
  let disposed = false;
  const disposing = f.runtime.dispose().then(() => {
    disposed = true;
  });
  await until(() => signal!.aborted);
  expect(disposed).toBe(false);
  release();
  await Promise.all([disposing, rejected]);
  expect(disposed).toBe(true);
});
