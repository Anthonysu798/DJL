import { createServer, type Server } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import type {
  MultiPostBrowserRuntime,
  MultiPostRuntimeContext,
  MultiPostScope,
  MultiPostAccount,
} from "@synara/contracts";
export async function startMultiPostHost(runtime: MultiPostBrowserRuntime) {
  const token = randomBytes(32).toString("hex");
  const server: Server = createServer(async (req, res) => {
    const supplied = Buffer.from(req.headers.authorization?.replace(/^Bearer /, "") ?? "");
    const expected = Buffer.from(token);
    if (
      req.headers.origin ||
      supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected)
    ) {
      res.writeHead(401).end();
      return;
    }
    if (req.method !== "POST" || req.url !== "/multipost") {
      res.writeHead(404).end();
      return;
    }
    try {
      let bytes = 0;
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > 2 * 1024 * 1024) throw new Error("Host request too large");
        chunks.push(chunk);
      }
      const controller = new AbortController();
      res.once("close", () => {
        if (!res.writableEnded) controller.abort();
      });
      const input = JSON.parse(Buffer.concat(chunks).toString()) as {
        action: string;
        scope: MultiPostScope;
        account: MultiPostAccount;
        context: MultiPostRuntimeContext;
      };
      let result: unknown;
      switch (input.action) {
        case "available":
          result = await runtime.available();
          break;
        case "connect":
          result = await runtime.connect(input.scope, input.account);
          break;
        case "identity":
          result = await runtime.identity(input.scope, input.account);
          break;
        case "disconnect":
          result = await runtime.disconnect(input.scope, input.account);
          break;
        case "prepare":
          result = await runtime.prepare(input.context, controller.signal);
          break;
        case "submit":
          result = await runtime.submit(input.context, controller.signal);
          break;
        case "open":
          result = await runtime.open?.(input.context);
          break;
        case "close":
          result = await runtime.close?.(input.context);
          break;
        case "verify":
          result = await runtime.verify(input.context);
          break;
        case "cancel":
          result = await runtime.cancel(input.context);
          break;
        default:
          throw new Error("Unknown MultiPost host operation");
      }
      res
        .writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" })
        .end(JSON.stringify({ result: result ?? null }));
    } catch (error) {
      res.writeHead(400, { "Content-Type": "application/json" }).end(
        JSON.stringify({
          error: error instanceof Error ? error.message : "MultiPost host failed",
        }),
      );
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("MultiPost host has no address");
  return {
    url: `http://127.0.0.1:${address.port}/multipost`,
    token,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}
