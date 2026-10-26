import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { timingSafeEqual } from "node:crypto";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const METHODS = new Set([
  "initialize",
  "initialized",
  "thread/list",
  "thread/start",
  "thread/resume",
  "turn/start",
  "turn/interrupt",
]);

export function containerArgs(runId: string, image: string, network: string): string[] {
  if (
    !UUID.test(runId) ||
    !/^[a-zA-Z0-9_.:/@-]+$/.test(image) ||
    !/^[a-zA-Z0-9_.-]+$/.test(network)
  )
    throw new Error("Invalid runner configuration");
  return [
    "run",
    "--rm",
    "-i",
    "--name",
    `djl-codex-${runId}`,
    "--label",
    "djl.codex=true",
    "--network",
    network,
    "--read-only",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--pids-limit",
    "256",
    "--memory",
    "1g",
    "--cpus",
    "1",
    "--tmpfs",
    "/tmp:rw,noexec,nosuid,size=256m",
    "--mount",
    `type=volume,source=djl-codex-${runId},target=/state`,
    "--user",
    "1000:1000",
    image,
  ];
}

interface Session {
  readonly runId: string;
  readonly token: string;
  readonly process: ChildProcessWithoutNullStreams;
  readonly events: Record<string, unknown>[];
  readonly pending: Map<number, { resolve: (value: unknown) => void; reject: () => void }>;
  readonly expires: number;
  seq: number;
  id: number;
  outputBytes: number;
  closed: boolean;
}
const command = (args: string[]) =>
  new Promise<void>((resolve, reject) => {
    const child = spawn("docker", args, { stdio: "ignore" });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error("Container operation failed")),
    );
  });
const authorized = (request: Request, token: string) => {
  const actual = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${token}`);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
};

/** Trusted container controller. User code runs only in children with a private network and volume. */
export function createBroker(options: {
  token: string;
  image: string;
  network: string;
  gatewayUrl: string;
  concurrency?: number;
}) {
  if (options.token.length < 32)
    throw new Error("CODEX_BROKER_TOKEN must have at least 32 characters");
  const sessions = new Map<string, Session>();
  const stop = async (id: string, retain = false) => {
    const session = sessions.get(id);
    if (!session) return;
    session.closed = true;
    sessions.delete(id);
    await command(["rm", "-f", `djl-codex-${session.runId}`]).catch(() => undefined);
    session.process.kill();
    for (const pending of session.pending.values()) pending.reject();
    session.pending.clear();
    if (!retain)
      await command(["volume", "rm", `djl-codex-${session.runId}`]).catch(() => undefined);
  };
  const timer = setInterval(() => {
    for (const [id, session] of sessions) if (session.expires < Date.now()) void stop(id);
  }, 30_000);
  timer.unref();

  return {
    async close() {
      clearInterval(timer);
      await Promise.all([...sessions.keys()].map((id) => stop(id, true)));
    },
    async fetch(request: Request): Promise<Response> {
      const path = new URL(request.url).pathname;
      if (path === "/health" && request.method === "GET")
        return Response.json({ ok: true, runtime: "codex" });
      if (path === "/v1/responses" && request.method === "POST") {
        const session = [...sessions.values()].find(
          (s) => !s.closed && s.expires > Date.now() && authorized(request, s.token),
        );
        if (!session) return new Response(null, { status: 401 });
        // Fixed upstream: a task cannot select arbitrary hosts or reach the worker's other APIs.
        const response = await fetch(`${options.gatewayUrl}/v1/responses`, {
          method: "POST",
          headers: { authorization: `Bearer ${session.token}`, "content-type": "application/json" },
          body: request.body,
          signal: request.signal,
          duplex: "half",
        } as RequestInit);
        return new Response(response.body, {
          status: response.status,
          headers: {
            "content-type": response.headers.get("content-type") ?? "application/json",
            "cache-control": "no-store",
          },
        });
      }
      if (!authorized(request, options.token)) return new Response(null, { status: 401 });
      if (request.method !== "POST") return new Response(null, { status: 405 });
      try {
        const text = await request.text();
        if (text.length > 6 * 1024 * 1024) return new Response(null, { status: 413 });
        const body = JSON.parse(text) as Record<string, unknown>;
        if (path === "/runs/start") {
          if (sessions.size >= (options.concurrency ?? 4))
            return new Response(null, { status: 429 });
          if (
            typeof body.runId !== "string" ||
            !UUID.test(body.runId) ||
            typeof body.gatewayToken !== "string" ||
            body.gatewayToken.length < 32 ||
            typeof body.model !== "string" ||
            !/^[a-zA-Z0-9._:/-]{1,256}$/.test(body.model)
          )
            return new Response(null, { status: 400 });
          for (const [id, session] of sessions)
            if (session.runId === body.runId) await stop(id, true);
          // A worker crash can leave a container; stop it before resuming the same private volume.
          await command(["rm", "-f", `djl-codex-${body.runId}`]).catch(() => undefined);
          const process = spawn(
            "docker",
            containerArgs(body.runId, options.image, options.network),
            { stdio: ["pipe", "pipe", "pipe"] },
          );
          const id = crypto.randomUUID();
          const session: Session = {
            runId: body.runId,
            token: body.gatewayToken,
            process,
            events: [],
            pending: new Map(),
            expires: Date.now() + 31 * 60_000,
            seq: 0,
            id: 0,
            outputBytes: 0,
            closed: false,
          };
          sessions.set(id, session);
          let buffer = "";
          process.stdout.on("data", (bytes: Buffer) => {
            buffer += bytes.toString();
            if (buffer.length > 4 * 1024 * 1024) {
              void stop(id);
              return;
            }
            let end: number;
            while ((end = buffer.indexOf("\n")) >= 0) {
              const line = buffer.slice(0, end);
              buffer = buffer.slice(end + 1);
              try {
                const frame = JSON.parse(line) as Record<string, unknown>;
                if (typeof frame.id === "number" && !frame.method) {
                  const pending = session.pending.get(frame.id);
                  session.pending.delete(frame.id);
                  if (frame.error) pending?.reject();
                  else pending?.resolve(frame.result ?? {});
                } else if (frame.method && frame.id !== undefined) {
                  // No approval may grant access outside the outer container. Refuse unknown server requests.
                  process.stdin.write(
                    `${JSON.stringify({ id: frame.id, error: { code: -32601, message: "Server request not permitted in cloud runtime." } })}\n`,
                  );
                } else {
                  session.outputBytes += line.length;
                  if (session.outputBytes > 8 * 1024 * 1024) {
                    void stop(id);
                    return;
                  }
                  session.events.push({ ...frame, seq: ++session.seq });
                }
              } catch {
                void stop(id);
              }
            }
          });
          process.stderr.resume(); // Never log workspace output or inference content.
          const exited = () => {
            session.closed = true;
            for (const p of session.pending.values()) p.reject();
            session.pending.clear();
          };
          process.on("error", exited);
          process.on("exit", exited);
          process.stdin.write(
            `${JSON.stringify({ model: body.model, token: body.gatewayToken, gatewayUrl: "http://codex-broker:8090/v1" })}\n`,
          );
          return Response.json({ sessionId: id });
        }
        const matched = /^\/runs\/([0-9a-f-]+)\/(rpc|events|stop)$/.exec(path);
        const session = matched ? sessions.get(matched[1]!) : undefined;
        if (!session || !matched) return new Response(null, { status: 404 });
        if (matched[2] === "stop") {
          await stop(matched[1]!, body.retain === true);
          return Response.json({ ok: true });
        }
        if (session.closed) {
          await stop(matched[1]!);
          return new Response(null, { status: 410 });
        }
        if (matched[2] === "events") {
          const after = Number(body.after);
          if (!Number.isSafeInteger(after) || after < 0) return new Response(null, { status: 400 });
          if (after >= session.seq) await new Promise((resolve) => setTimeout(resolve, 25));
          const events = session.events.filter((event) => Number(event.seq) > after);
          return Response.json({ events });
        }
        if (typeof body.method !== "string" || !METHODS.has(body.method))
          return new Response(null, { status: 400 });
        if (body.method === "initialized") {
          session.process.stdin.write(
            `${JSON.stringify({ method: body.method, params: body.params })}\n`,
          );
          return Response.json({});
        }
        const rpcId = ++session.id;
        const result = await new Promise<unknown>((resolve, reject) => {
          const timer = setTimeout(() => {
            session.pending.delete(rpcId);
            reject(new Error("RPC timeout"));
          }, 15_000);
          session.pending.set(rpcId, {
            resolve: (value) => {
              clearTimeout(timer);
              resolve(value);
            },
            reject: () => {
              clearTimeout(timer);
              reject(new Error("RPC failed"));
            },
          });
          session.process.stdin.write(
            `${JSON.stringify({ id: rpcId, method: body.method, params: body.params })}\n`,
          );
        });
        return Response.json(result);
      } catch {
        return Response.json(
          {
            error: { code: "codex_broker_error", message: "Cloud coding runtime request failed." },
          },
          { status: 502 },
        );
      }
    },
  };
}

if (import.meta.main) {
  const broker = createBroker({
    token: process.env.CODEX_BROKER_TOKEN ?? "",
    image: process.env.CODEX_IMAGE ?? "djl-codex:0.125.0",
    network: process.env.CODEX_NETWORK ?? "djl-codex",
    gatewayUrl: process.env.CODEX_GATEWAY_URL ?? "http://worker:8081",
    concurrency: Number(process.env.CODEX_CONCURRENCY ?? 4),
  });
  const server = Bun.serve({
    port: 8090,
    hostname: "0.0.0.0",
    maxRequestBodySize: 6 * 1024 * 1024,
    fetch: (request) => broker.fetch(request),
  });
  for (const signal of ["SIGTERM", "SIGINT"])
    process.on(signal, () => {
      server.stop(true);
      void broker.close().then(() => process.exit(0));
    });
}
