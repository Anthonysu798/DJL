import { createRequire } from "node:module";
import { Socket } from "node:net";
import type { Client as UndiciClient } from "undici/index.js";
import { Schema } from "effect";
import { ComputerActivitySummaryJob, type ComputerActivitySummaryCommand } from "@synara/contracts";

const Reply = Schema.Union([
  Schema.Struct({
    operation: Schema.Literal("claim"),
    job: Schema.NullOr(ComputerActivitySummaryJob),
  }),
  Schema.Struct({ operation: Schema.Literal("valid"), valid: Schema.Boolean }),
  Schema.Struct({ operation: Schema.Literals(["complete", "fail"]), accepted: Schema.Boolean }),
]);
export type SummaryHostReply = typeof Reply.Type;
const MAX_BODY = 8 * 1024 * 1024;
const MAX_HEADERS = 16 * 1024;
const unavailable = () => new Error("Activity host unavailable");
const cancelled = () => new Error("Activity generation cancelled");
const tooLarge = () => new Error("Activity response too large");
const mismatch = () => new Error("Activity response mismatch");

export function decodeSummaryHostReply(
  bytes: Uint8Array,
  operation: ComputerActivitySummaryCommand["operation"],
): SummaryHostReply {
  let reply: SummaryHostReply;
  try {
    reply = Schema.decodeUnknownSync(Reply)(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
      { onExcessProperty: "error" },
    );
  } catch {
    throw unavailable();
  }
  if (reply.operation !== operation) throw mismatch();
  return reply;
}

// The public entry ordinarily initializes absent dispatcher defaults. Preserve any
// existing identities, including a current-only state that entry would overwrite.
function clientConstructor() {
  const globals = globalThis as Record<symbol, unknown>;
  if (
    globals[Symbol.for("undici.globalDispatcher.1")] === undefined &&
    globals[Symbol.for("undici.globalDispatcher.2")] !== undefined
  )
    throw unavailable();
  return (
    createRequire(typeof __filename === "string" ? __filename : import.meta.url)(
      "undici/index.js",
    ) as typeof import("undici/index.js")
  ).Client;
}

export function createComputerActivitySummaryHostClient(
  credentials: Readonly<{ url: string; token: string }>,
) {
  const { url, token } = credentials;
  if (
    typeof url !== "string" ||
    typeof token !== "string" ||
    !/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}\/computer-use$/.test(url) ||
    !/^[!-~]+$/.test(token)
  )
    throw unavailable();
  let endpoint: URL;
  try {
    endpoint = new URL(url);
  } catch {
    throw unavailable();
  }
  if (endpoint.href !== url || Number(endpoint.port || 80) > 65_535) throw unavailable();
  const port = Number(endpoint.port || 80);
  const headersFor = (length: number) => {
    const headers = {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      accept: "application/json",
      "accept-encoding": "identity",
      host: `127.0.0.1:${port}`,
      connection: "close",
      "content-length": String(length),
    };
    if (
      Object.entries(headers).reduce(
        (bytes, [name, value]) => bytes + Buffer.byteLength(`${name}: ${value}\r\n`),
        2,
      ) > MAX_HEADERS
    )
      throw unavailable();
    return headers;
  };
  headersFor(MAX_BODY);
  const lifetime = new AbortController();
  const pending = new Set<Promise<SummaryHostReply>>();
  let closed = false;
  let disposal: Promise<void> | undefined;

  async function perform(
    command: ComputerActivitySummaryCommand,
    caller: AbortSignal,
    deadline: number,
  ): Promise<SummaryHostReply> {
    const timeout = new AbortController();
    const signal = AbortSignal.any([caller, lifetime.signal, timeout.signal]);
    const check = () => {
      if (caller.aborted || lifetime.signal.aborted) throw cancelled();
      if (timeout.signal.aborted || performance.now() >= deadline) throw unavailable();
    };
    const timer = setTimeout(() => timeout.abort(), Math.max(0, deadline - performance.now()));
    let client: UndiciClient | undefined, socket: Socket | undefined;
    let socketClosed: Promise<void> | undefined;
    let closing = false;

    try {
      check();
      const serialized = JSON.stringify(command);
      check();
      if (Buffer.byteLength(serialized) > MAX_BODY) throw unavailable();
      const body = Buffer.from(serialized);
      const headers = headersFor(body.length);
      check();
      const Client = clientConstructor();
      client = new Client(`http://127.0.0.1:${port}`, {
        pipelining: 0,
        allowH2: false,
        strictContentLength: true,
        maxHeaderSize: MAX_HEADERS,
        headersTimeout: 5_000,
        bodyTimeout: 5_000,
        connect: (_options, callback) => {
          if (closing || signal.aborted || socket) {
            callback(unavailable(), null);
            return;
          }
          // Install ownership before connection work. Client.destroy alone does
          // not join a connector that has not delivered its HTTP context yet.
          const owned = new Socket();
          socket = owned;
          socketClosed = new Promise<void>((done) => owned.once("close", () => done()));
          let delivered = false;
          const failed = () => {
            if (!delivered) {
              delivered = true;
              callback(unavailable(), null);
            }
          };
          owned.once("error", failed);
          owned.once("close", failed);
          owned.once("connect", () => {
            if (closing || signal.aborted) {
              owned.destroy();
              failed();
              return;
            }
            delivered = true;
            callback(null, owned);
          });
          owned.connect({ host: "127.0.0.1", port });
        },
      });
      const bytes = await new Promise<Buffer>((resolve, reject) => {
        let controller: import("undici/index.js").Dispatcher.DispatchController | undefined;
        const stop = (error: Error = unavailable()) => {
          reject(error);
          controller?.abort(unavailable());
        };
        const abort = () => {
          socket?.destroy();
          stop();
        };
        signal.addEventListener("abort", abort, { once: true });
        const buffer = Buffer.alloc(MAX_BODY);
        let length = 0;
        try {
          client!.dispatch(
            {
              path: "/computer-use/summary-jobs",
              method: "POST",
              headers,
              body,
              idempotent: false,
            },
            {
              onRequestStart(current) {
                controller = current;
                if (signal.aborted) abort();
              },
              onResponseStart(current, status, received) {
                try {
                  check();
                  const raw = current.rawHeaders;
                  if (
                    !Array.isArray(raw) ||
                    raw.length > 128 ||
                    raw.reduce((bytes, part) => bytes + Buffer.byteLength(part) + 2, 2) >
                      MAX_HEADERS
                  )
                    throw unavailable();
                  if (status < 200 || status >= 300) throw unavailable();
                  if (
                    received["content-encoding"] !== undefined &&
                    received["content-encoding"] !== "identity"
                  )
                    throw unavailable();
                  if (
                    received["content-length"] !== undefined &&
                    Number(received["content-length"]) > MAX_BODY
                  )
                    throw tooLarge();
                } catch (error) {
                  stop(error instanceof Error ? error : unavailable());
                }
              },
              onResponseData(_current, chunk) {
                try {
                  check();
                  if (length + chunk.length > MAX_BODY) throw tooLarge();
                  chunk.copy(buffer, length);
                  length += chunk.length;
                } catch (error) {
                  stop(error instanceof Error ? error : unavailable());
                }
              },
              onResponseEnd(current) {
                signal.removeEventListener("abort", abort);
                try {
                  check();
                  const trailers = current.rawTrailers;
                  if (trailers != null && (!Array.isArray(trailers) || trailers.length !== 0))
                    throw unavailable();
                  resolve(buffer.subarray(0, length));
                } catch (error) {
                  reject(error);
                }
              },
              onResponseError() {
                signal.removeEventListener("abort", abort);
                reject(unavailable());
              },
              onRequestUpgrade(_current, _status, _headers, upgraded) {
                signal.removeEventListener("abort", abort);
                upgraded.destroy();
                stop();
              },
            },
          );
        } catch {
          signal.removeEventListener("abort", abort);
          reject(unavailable());
        }
      });
      check();
      const reply = decodeSummaryHostReply(bytes, command.operation);
      check();
      return reply;
    } catch (error) {
      check();
      if (
        error instanceof Error &&
        [
          "Activity host unavailable",
          "Activity response too large",
          "Activity response mismatch",
        ].includes(error.message)
      )
        throw error;
      throw unavailable();
    } finally {
      closing = true;
      socket?.destroy();
      // Both joins are required, including cancellation before connector delivery.
      await Promise.all([client?.destroy(), socketClosed]);
      clearTimeout(timer);
    }
  }

  return {
    request(
      command: ComputerActivitySummaryCommand,
      signal: AbortSignal,
    ): Promise<SummaryHostReply> {
      const deadline = performance.now() + 5_000;
      if (closed) return Promise.reject(cancelled());
      if (pending.size >= 2) return Promise.reject(unavailable());
      // Enroll before yielding or performing I/O; cancellation never detaches ownership.
      const operation = Promise.resolve()
        .then(() => perform(command, signal, deadline))
        .then((reply) => {
          if (signal.aborted || lifetime.signal.aborted) throw cancelled();
          if (performance.now() >= deadline) throw unavailable();
          return reply;
        });
      pending.add(operation);
      const retire = () => {
        pending.delete(operation);
      };
      void operation.then(retire, retire);
      return operation;
    },
    dispose(): Promise<void> {
      if (disposal) return disposal;
      closed = true;
      lifetime.abort();
      disposal = Promise.allSettled(pending).then(() => undefined);
      return disposal;
    },
  };
}
