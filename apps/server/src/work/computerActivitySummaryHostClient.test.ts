import { createServer, Socket, type AddressInfo } from "node:net";
import type { ComputerActivitySummaryCommand, ComputerActivitySummaryJob } from "@synara/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ComputerActivitySummaryWorker,
  type ComputerActivitySummaryGenerationInput,
} from "./computerActivitySummarization";
import { createComputerActivitySummaryHostClient } from "./computerActivitySummaryHostClient";

const LIMIT = 8 * 1024 * 1024;
const clients: Array<{ dispose(): Promise<void> }> = [];
const cleanup: Array<() => Promise<void>> = [];
const signal = () => new AbortController().signal;
const barrier = () => new Promise<void>((resolve) => setImmediate(resolve));
async function until(predicate: () => boolean) {
  const deadline = performance.now() + 2000;
  while (!predicate()) {
    if (performance.now() >= deadline) throw new Error("Owned wire fixture did not advance");
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(clients.splice(0).map((client) => client.dispose()));
  await Promise.all(cleanup.splice(0).map((close) => close()));
});
function response(
  body: string | Buffer = '{"operation":"claim","job":null}',
  headers: string[] = [],
) {
  return Buffer.concat([
    Buffer.from(
      `HTTP/1.1 200 OK\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n${headers.map((header) => `${header}\r\n`).join("")}\r\n`,
    ),
    Buffer.from(body),
  ]);
}
async function wire(reply: (socket: Socket, command: ComputerActivitySummaryCommand) => void) {
  const sockets = new Set<Socket>();
  const commands: ComputerActivitySummaryCommand[] = [];
  const requests: string[] = [];
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("error", () => undefined);
    socket.once("close", () => sockets.delete(socket));
    let buffer = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      const boundary = buffer.indexOf("\r\n\r\n");
      if (boundary < 0) return;
      const header = buffer.subarray(0, boundary).toString();
      const length = Number(/content-length: (\d+)/i.exec(header)?.[1]);
      if (buffer.length < boundary + 4 + length) return;
      socket.removeAllListeners("data");
      requests.push(header);
      const command = JSON.parse(
        buffer.subarray(boundary + 4).toString(),
      ) as ComputerActivitySummaryCommand;
      commands.push(command);
      reply(socket, command);
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = (server.address() as AddressInfo).port;
  cleanup.push(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    expect(sockets.size).toBe(0);
  });
  const credentials = { url: `http://127.0.0.1:${port}/computer-use`, token: "fixture-private" };
  const client = createComputerActivitySummaryHostClient(credentials);
  clients.push(client);
  return { sockets, commands, requests, client, credentials, port };
}
async function retired(f: Awaited<ReturnType<typeof wire>>) {
  await until(() => f.sockets.size === 0);
  await barrier();
  expect(f.sockets.size).toBe(0);
}
async function rejected(bytes: Buffer | string, error = "Activity host unavailable") {
  const f = await wire((socket) => socket.end(bytes));
  await expect(f.client.request({ operation: "claim" }, signal())).rejects.toThrow(error);
  await retired(f);
}

it("snapshots authority, uses only owned POST framing, and rejects post-close admission", async () => {
  const f = await wire((socket) => socket.end(response()));
  f.credentials.url = "http://127.0.0.1:1/computer-use";
  f.credentials.token = "changed";
  expect(await f.client.request({ operation: "claim" }, signal())).toEqual({
    operation: "claim",
    job: null,
  });
  expect(f.requests[0]!.split("\r\n")[0]).toBe("POST /computer-use/summary-jobs HTTP/1.1");
  expect(f.requests[0]).toContain("authorization: Bearer fixture-private");
  const names = f.requests[0]!.split("\r\n")
    .slice(1)
    .map((line) => line.split(":")[0]);
  expect(names.toSorted()).toEqual(
    [
      "accept",
      "accept-encoding",
      "authorization",
      "connection",
      "content-length",
      "content-type",
      "host",
    ].toSorted(),
  );
  await retired(f);
  const closing = f.client.dispose();
  expect(f.client.dispose()).toBe(closing);
  await closing;
  await expect(f.client.request({ operation: "claim" }, signal())).rejects.toThrow(
    "Activity generation cancelled",
  );
  expect(f.commands).toHaveLength(1);
});
it.each([
  "http://localhost:1234/computer-use",
  "http://127.0.0.1:0/computer-use",
  "http://127.0.0.1:65536/computer-use",
  "http://127.0.0.1:80/computer-use",
  "http://127.0.0.1:01234/computer-use",
  "http://127.0.0.1:1234/computer-use/",
  "http://127.0.0.1:1234/computer-use?x=1",
  "https://127.0.0.1:1234/computer-use",
])("rejects noncanonical authority %s", (url) => {
  expect(() => createComputerActivitySummaryHostClient({ url, token: "fixture" })).toThrow(
    "Activity host unavailable",
  );
});
it.each(["", "bad token", "bad\r\nheader", "é", "x".repeat(16384)])(
  "rejects invalid/oversized bearer before I/O (%#)",
  (token) => {
    expect(() =>
      createComputerActivitySummaryHostClient({ url: "http://127.0.0.1:1234/computer-use", token }),
    ).toThrow("Activity host unavailable");
  },
);
it("bounds serialized outgoing material before I/O", async () => {
  const f = await wire((socket) => socket.end(response()));
  const command = {
    operation: "claim",
    extra: "x".repeat(LIMIT),
  } as unknown as ComputerActivitySummaryCommand;
  await expect(f.client.request(command, signal())).rejects.toThrow("Activity host unavailable");
  expect(f.commands).toHaveLength(0);
});
it.each([
  ["malformed JSON", Buffer.from("{private body")],
  ["invalid UTF8", Buffer.from([0xff])],
  ["excess field", Buffer.from('{"operation":"claim","job":null,"extra":"private"}')],
  ["invalid job", Buffer.from('{"operation":"claim","job":{}}')],
])("sanitizes %s and retires the peer", async (_name, body) => rejected(response(body)));
it("rejects operation mismatch with a fixed error", async () =>
  rejected(response('{"operation":"valid","valid":true}'), "Activity response mismatch"));
it.each([LIMIT, LIMIT + 1])("checks the exact %i byte body boundary", async (size) => {
  const json = '{"operation":"claim","job":null}';
  const body = Buffer.from(json + " ".repeat(size - json.length));
  const f = await wire((socket) => socket.end(response(body)));
  const result = f.client.request({ operation: "claim" }, signal());
  if (size === LIMIT) await expect(result).resolves.toEqual({ operation: "claim", job: null });
  else await expect(result).rejects.toThrow("Activity response too large");
  await retired(f);
});
it("rejects streamed overflow without trusting content-length", async () => {
  const f = await wire((socket) => {
    socket.write("HTTP/1.1 200 OK\r\nConnection: close\r\n\r\n");
    socket.end(Buffer.alloc(LIMIT + 1, 32));
  });
  await expect(f.client.request({ operation: "claim" }, signal())).rejects.toThrow(
    "Activity response too large",
  );
  await retired(f);
});
it.each([64, 65])("preserves the %i-pair initial-header boundary sentinel", async (count) => {
  // response() adds content-length and connection: two initial pairs.
  const f = await wire((socket) =>
    socket.end(
      response(
        undefined,
        Array.from({ length: count - 2 }, (_, i) => `X-${i}: v`),
      ),
    ),
  );
  const result = f.client.request({ operation: "claim" }, signal());
  if (count === 64) await expect(result).resolves.toEqual({ operation: "claim", job: null });
  else await expect(result).rejects.toThrow("Activity host unavailable");
  await retired(f);
});
it.each([16384, 16385])("checks %i serialized response header bytes", async (size) => {
  const body = '{"operation":"claim","job":null}';
  const base = `Content-Length: ${body.length}\r\nConnection: close\r\nX-Padding: \r\n\r\n`;
  const raw = `HTTP/1.1 200 OK\r\nContent-Length: ${body.length}\r\nConnection: close\r\nX-Padding: ${"a".repeat(size - Buffer.byteLength(base))}\r\n\r\n${body}`;
  const f = await wire((socket) => socket.end(raw));
  const result = f.client.request({ operation: "claim" }, signal());
  if (size === 16384) await expect(result).resolves.toMatchObject({ job: null });
  else await expect(result).rejects.toThrow("Activity host unavailable");
  await retired(f);
});
it.each([0, 1, 65, 1000])("rejects nonempty trailers (%i pairs)", async (count) => {
  const body = '{"operation":"claim","job":null}';
  const raw = `HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n${body.length.toString(16)}\r\n${body}\r\n0\r\n${Array.from({ length: count }, (_, i) => `X-T-${i}: v\r\n`).join("")}\r\n`;
  const f = await wire((socket) => socket.end(raw));
  const result = f.client.request({ operation: "claim" }, signal());
  if (count === 0) await expect(result).resolves.toMatchObject({ job: null });
  else await expect(result).rejects.toThrow("Activity host unavailable");
  await retired(f);
});
it.each(["gzip", "deflate", "br"])("rejects %s without decoding", async (encoding) =>
  rejected(response(undefined, [`Content-Encoding: ${encoding}`])),
);
it("accepts explicit identity", async () => {
  const f = await wire((socket) => socket.end(response(undefined, ["Content-Encoding: identity"])));
  await expect(f.client.request({ operation: "claim" }, signal())).resolves.toMatchObject({
    job: null,
  });
  await retired(f);
});
it("never redirects authority to a second owned listener", async () => {
  const destination = await wire((socket) => socket.end(response()));
  await rejected(
    `HTTP/1.1 302 Found\r\nLocation: ${destination.credentials.url}\r\nContent-Length: 0\r\n\r\n`,
  );
  expect(destination.commands).toHaveLength(0);
});
it.each([
  "HTTP/1.1 503 Private diagnostic\r\nContent-Length: 99999999\r\n\r\nprivate",
  "HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: private\r\n\r\n",
  "HTTP/1.1 100 Continue\r\n\r\n",
  "HTTP/1.1 103 Early Hints\r\n\r\n",
])("rejects status/upgrade/information without raw diagnostics (%#)", async (raw) => rejected(raw));
it("rejects partial body disconnect and immediate refusal with fixed errors", async () => {
  await rejected("HTTP/1.1 200 OK\r\nContent-Length: 200\r\nConnection: close\r\n\r\npartial");
  const client = createComputerActivitySummaryHostClient({
    url: "http://127.0.0.1:1/computer-use",
    token: "fixture",
  });
  clients.push(client);
  await expect(client.request({ operation: "claim" }, signal())).rejects.toThrow(
    "Activity host unavailable",
  );
});
it("rejects pre-abort without a request and active abort retires the peer", async () => {
  const f = await wire(() => undefined);
  const pre = new AbortController();
  pre.abort();
  await expect(f.client.request({ operation: "claim" }, pre.signal)).rejects.toThrow(
    "Activity generation cancelled",
  );
  expect(f.commands).toHaveLength(0);
  const active = new AbortController();
  const result = f.client.request({ operation: "claim" }, active.signal);
  const rejected = expect(result).rejects.toThrow("Activity generation cancelled");
  await until(() => f.commands.length === 1);
  active.abort();
  await rejected;
  await retired(f);
});
it("allows two private commands but rejects excess admission without queuing", async () => {
  const f = await wire(() => undefined);
  const first = f.client.request({ operation: "claim" }, signal());
  const second = f.client.request({ operation: "valid", leaseId: "fixture" }, signal());
  const outcomes = Promise.allSettled([first, second]);
  await expect(f.client.request({ operation: "claim" }, signal())).rejects.toThrow(
    "Activity host unavailable",
  );
  await until(() => f.commands.length === 2);
  await f.client.dispose();
  expect((await outcomes).every((outcome) => outcome.status === "rejected")).toBe(true);
  await retired(f);
});
it.each(["headers", "body", "combined"])(
  "uses the original five-second deadline through slow %s",
  async (phase) => {
    const timers: Array<ReturnType<typeof setTimeout>> = [];
    const f = await wire((socket) => {
      const header = "HTTP/1.1 200 OK\r\nContent-Length: 32\r\nConnection: close\r\n\r\n";
      if (phase === "headers") return;
      if (phase === "body") socket.write(header);
      else
        timers.push(
          setTimeout(() => {
            if (!socket.destroyed) socket.write(header);
          }, 2800),
        );
      timers.push(
        setTimeout(() => {
          if (!socket.destroyed) socket.end('{"operation":"claim","job":null}');
        }, 5600),
      );
    });
    const started = performance.now();
    try {
      await expect(f.client.request({ operation: "claim" }, signal())).rejects.toThrow(
        "Activity host unavailable",
      );
      expect(performance.now() - started).toBeGreaterThanOrEqual(4800);
      expect(performance.now() - started).toBeLessThan(5500);
      await retired(f);
    } finally {
      timers.forEach(clearTimeout);
    }
  },
  8000,
);

it("enrolls before I/O and closes admission synchronously even before the operation starts", async () => {
  const f = await wire(() => undefined);
  const pending = f.client.request({ operation: "claim" }, signal());
  const result = expect(pending).rejects.toThrow("Activity generation cancelled");
  await f.client.dispose();
  await result;
  expect(f.commands).toHaveLength(0);
  expect(f.sockets.size).toBe(0);
});
it.each(["serialization", "decoding"])(
  "does not return success after synchronous %s exhausts the original deadline",
  async (phase) => {
    const f = await wire((socket) => socket.end(response()));
    const original = performance.now.bind(performance);
    let elapsed = 0;
    vi.spyOn(performance, "now").mockImplementation(() => original() + elapsed);
    let command: ComputerActivitySummaryCommand = { operation: "claim" };
    if (phase === "serialization")
      command = {
        operation: "claim",
        toJSON: () => {
          elapsed = 5001;
          return { operation: "claim" };
        },
      } as ComputerActivitySummaryCommand;
    else {
      const decode = TextDecoder.prototype.decode;
      vi.spyOn(TextDecoder.prototype, "decode").mockImplementation(function (
        this: TextDecoder,
        ...args: Parameters<TextDecoder["decode"]>
      ) {
        const result = decode.apply(this, args);
        elapsed = 5001;
        return result;
      });
    }
    await expect(f.client.request(command, signal())).rejects.toThrow("Activity host unavailable");
    vi.restoreAllMocks();
    if (phase === "serialization") expect(f.commands).toHaveLength(0);
    await retired(f);
  },
);

const content = {
  title: "Fixture",
  description: "Synthetic draft reviewed.",
  applications: ["org.fixture"],
  memory: "Draft",
  recording: "Draft",
  citations: ["event-a"],
};
function job(periodSeconds: 600 | 21600): ComputerActivitySummaryJob {
  const end = Date.now() - 1000;
  const base = {
    id: "job-private",
    leaseId: "lease-private",
    generation: "generation-private",
    expiresAt: new Date(Date.now() + 180000).toISOString(),
    startedAt: new Date(end - periodSeconds * 1000).toISOString(),
    endedAt: new Date(end).toISOString(),
    sourceIds: ["event-a"],
    applications: ["org.fixture"],
    sourceFingerprint: "a".repeat(64),
    omittedRecordCount: 0,
  };
  return periodSeconds === 600
    ? { ...base, periodSeconds, material: "Synthetic only", previousSummaries: [] }
    : {
        ...base,
        periodSeconds,
        sourceIds: ["child-a"],
        children: [
          {
            id: "child-a",
            periodSeconds: 600,
            startedAt: new Date(end - 600000).toISOString(),
            endedAt: new Date(end).toISOString(),
            generatedAt: new Date(end).toISOString(),
            sourceIds: ["event-a"],
            sourceFingerprint: "b".repeat(64),
            provider: "codex",
            model: "fixture",
            content,
          },
        ],
      };
}
async function workerHost(input: {
  period?: 600 | 21600;
  hold?: string;
  fail?: boolean;
  monitor?: boolean;
}) {
  let valid = 0;
  const selected = job(input.period ?? 600);
  const f = await wire((socket, command) => {
    if (command.operation === input.hold && (command.operation !== "valid" || ++valid > 1)) return;
    const body =
      command.operation === "claim"
        ? { operation: "claim", job: selected }
        : command.operation === "valid"
          ? { operation: "valid", valid: true }
          : { operation: command.operation, accepted: true };
    socket.end(response(JSON.stringify(body)));
  });
  const generate = vi.fn(async ({ evidence }: ComputerActivitySummaryGenerationInput) => {
    const text = JSON.stringify(evidence);
    for (const secret of [
      "fixture-private",
      "lease-private",
      "generation-private",
      "job-private",
      "127.0.0.1",
    ])
      expect(text).not.toContain(secret);
    if (input.fail) throw new Error("private provider diagnostic");
    if (input.monitor) return new Promise<never>(() => undefined);
    return {
      content: { ...content, citations: input.period === 21600 ? ["child-a"] : ["event-a"] },
      provider: "codex",
      model: "fixture",
    };
  });
  const worker = new ComputerActivitySummaryWorker({ credentials: f.credentials, generate });
  clients.push(worker);
  return { ...f, worker, generate };
}
describe("actual default worker boundary", () => {
  it.each([600, 21600] as const)(
    "completes %i-second jobs without ambient fetch or authority in evidence",
    async (period) => {
      const f = await workerHost({ period });
      vi.stubGlobal("fetch", () => {
        throw new Error("Ambient fetch forbidden");
      });
      try {
        await f.worker.runOnce();
      } finally {
        vi.unstubAllGlobals();
      }
      expect(f.commands.map((command) => command.operation)).toEqual([
        "claim",
        "valid",
        "valid",
        "complete",
      ]);
      expect(f.generate).toHaveBeenCalledOnce();
      await f.worker.dispose();
      await retired(f);
    },
  );
  it("reports fixed failure without provider diagnostics", async () => {
    const f = await workerHost({ fail: true });
    await f.worker.runOnce();
    expect(f.commands.at(-1)).toMatchObject({ operation: "fail", code: "generation-failed" });
    expect(JSON.stringify(f.commands)).not.toContain("private provider diagnostic");
    await retired(f);
  });
  it.each(["claim", "valid", "complete"])(
    "disposes during pending %s and awaits a held terminal client close",
    async (hold) => {
      const f = await workerHost({ hold, monitor: hold === "valid" });
      const emit = Socket.prototype.emit;
      const held: Array<() => void> = [];
      const owned = new WeakSet<Socket>();
      const spy = vi.spyOn(Socket.prototype, "emit").mockImplementation(function (
        this: Socket,
        event: string | symbol,
        ...args: unknown[]
      ) {
        if (event === "connect" && this.remotePort === f.port) owned.add(this);
        if (event === "close" && owned.has(this)) {
          held.push(() => Reflect.apply(emit, this, [event, ...args]));
          return true;
        }
        return Reflect.apply(emit, this, [event, ...args]);
      });
      let closing: Promise<void> | undefined;
      const running = f.worker.runOnce();
      try {
        // Release initial completed commands so the requested pending phase can start.
        while (
          !f.commands.some(
            (command) =>
              command.operation === hold &&
              (hold !== "valid" || f.commands.filter((c) => c.operation === "valid").length > 1),
          )
        ) {
          held.splice(0).forEach((release) => release());
          await new Promise((resolve) => setTimeout(resolve, 1));
        }
        let disposed = false;
        closing = f.worker.dispose().then(() => {
          disposed = true;
        });
        await until(() => held.length > 0);
        await barrier();
        expect(disposed).toBe(false);
        const count = f.commands.length;
        await f.worker.runOnce();
        expect(f.commands).toHaveLength(count);
      } finally {
        spy.mockRestore();
        held.splice(0).forEach((release) => release());
        await (closing ?? f.worker.dispose());
        await running;
      }
      await retired(f);
      expect(f.commands.filter((command) => command.operation === "complete")).toHaveLength(
        hold === "complete" ? 1 : 0,
      );
    },
    5000,
  );
});

it("joins a connecting socket before callback delivery and denies late connection work", async () => {
  const f = await wire(() => undefined);
  const original = Socket.prototype.emit;
  const owned = new WeakSet<Socket>();
  const connectGate: Array<() => void> = [],
    closeGate: Array<() => void> = [];
  const spy = vi.spyOn(Socket.prototype, "emit").mockImplementation(function (
    this: Socket,
    event: string | symbol,
    ...args: unknown[]
  ) {
    if (event === "connect" && this.remotePort === f.port) {
      owned.add(this);
      connectGate.push(() => Reflect.apply(original, this, [event, ...args]));
      return true;
    }
    if (event === "close" && owned.has(this)) {
      closeGate.push(() => Reflect.apply(original, this, [event, ...args]));
      return true;
    }
    return Reflect.apply(original, this, [event, ...args]);
  });
  const result = f.client.request({ operation: "claim" }, signal());
  const rejected = expect(result).rejects.toThrow("Activity generation cancelled");
  let closing: Promise<void> | undefined;
  try {
    await until(() => connectGate.length === 1);
    let disposed = false;
    closing = f.client.dispose().then(() => {
      disposed = true;
    });
    await until(() => closeGate.length === 1);
    await barrier();
    expect(disposed).toBe(false);
    expect(f.commands).toHaveLength(0);
    closeGate.splice(0).forEach((release) => release());
    await closing;
    connectGate.splice(0).forEach((release) => release());
    await rejected;
    await barrier();
    expect(f.commands).toHaveLength(0);
  } finally {
    spy.mockRestore();
    closeGate.splice(0).forEach((release) => release());
    connectGate.splice(0).forEach((release) => release());
    await (closing ?? f.client.dispose());
    await rejected;
  }
  await retired(f);
});
