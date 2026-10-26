import { createHash } from "node:crypto";
import { ApiError } from "../../http/errors.ts";
import type { GatewayService, RequestFacts, StepResult } from "../../gateway/GatewayService.ts";

interface Scope {
  readonly model: string;
  readonly expiresAt: number;
  readonly signal: AbortSignal;
  readonly facts: () => Promise<RequestFacts>;
  readonly beginStep: () => Promise<void>;
  readonly settled: (result: StepResult) => Promise<void>;
  readonly budget: () => bigint;
  busy: boolean;
}
const digest = (token: string) => createHash("sha256").update(token).digest("hex");

/** In-memory credentials die with their worker lease. Only one inference may run per task. */
export class ScopedGateway {
  private readonly scopes = new Map<string, Scope>();
  constructor(private readonly gateway: Pick<GatewayService, "responsesStream">) {}

  open(input: Omit<Scope, "busy">): { token: string; close: () => void } {
    const token = `${crypto.randomUUID()}${crypto.randomUUID()}`;
    const key = digest(token);
    this.scopes.set(key, { ...input, busy: false });
    return {
      token,
      close: () => {
        this.scopes.delete(key);
      },
    };
  }

  async handle(request: Request): Promise<Response> {
    const authorization = request.headers.get("authorization") ?? "";
    const scope = this.scopes.get(digest(authorization.replace(/^Bearer /, "")));
    if (
      !authorization.startsWith("Bearer ") ||
      !scope ||
      scope.signal.aborted ||
      Date.now() >= scope.expiresAt
    )
      return Response.json(
        { error: { code: "unauthorized", message: "Task credential expired." } },
        { status: 401 },
      );
    if (request.method !== "POST" || new URL(request.url).pathname !== "/v1/responses")
      return new Response(null, { status: 404 });
    if (scope.busy)
      return Response.json(
        {
          error: {
            code: "concurrent_task_request",
            message: "Only one model request may run at a time.",
          },
        },
        { status: 409 },
      );
    scope.busy = true;
    let streaming = false;
    try {
      if (Number(request.headers.get("content-length") ?? 0) > 6 * 1024 * 1024)
        throw new ApiError(413, "payload_too_large", "Body too large.");
      const text = await request.text();
      if (text.length > 6 * 1024 * 1024)
        throw new ApiError(413, "payload_too_large", "Body too large.");
      const body: unknown = JSON.parse(text);
      if (
        typeof body !== "object" ||
        body === null ||
        (body as { model?: string }).model !== scope.model
      )
        throw new ApiError(403, "model_scope", "This credential is bound to the task's model.");
      const facts = await scope.facts();
      await scope.beginStep();
      const result = await this.gateway.responsesStream(facts, body, {
        signal: AbortSignal.any([scope.signal, request.signal]),
        budgetCap: scope.budget(),
        onResponseSettled: scope.settled,
      });
      const reader = result.stream.getReader();
      streaming = true;
      const stream = new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            const next = await reader.read();
            if (next.done) {
              scope.busy = false;
              controller.close();
            } else controller.enqueue(next.value);
          } catch (error) {
            scope.busy = false;
            controller.error(error);
          }
        },
        async cancel() {
          try {
            await reader.cancel();
          } finally {
            scope.busy = false;
          }
        },
      });
      return new Response(stream, {
        headers: {
          "content-type": "text/event-stream",
          "cache-control": "no-store",
          "x-accel-buffering": "no",
        },
      });
    } catch (error) {
      const api =
        error instanceof ApiError
          ? error
          : new ApiError(400, "bad_request", "Invalid Responses request.");
      return Response.json(
        { error: { code: api.code, message: api.message } },
        { status: api.status },
      );
    } finally {
      if (!streaming) scope.busy = false;
    }
  }
}
