import { ApiError } from "../http/errors.ts";
import { createHash, createHmac } from "node:crypto";

export interface HostController {
  request<T>(path: string, body?: unknown): Promise<T>;
}
export class ControllerClient implements HostController {
  constructor(
    private readonly url: string | undefined,
    private readonly token: string | undefined,
  ) {}
  async request<T>(path: string, body?: unknown): Promise<T> {
    if (!this.url || !this.token)
      throw new ApiError(503, "controller_unavailable", "VPS monitoring is not connected.");
    try {
      const url = new URL(path, this.url);
      const method = body === undefined ? "GET" : "POST";
      const payload = body === undefined ? "" : JSON.stringify(body);
      const timestamp = String(Math.floor(Date.now() / 1000));
      const nonce = crypto.randomUUID();
      const signature = createHmac("sha256", this.token)
        .update(
          [
            timestamp,
            nonce,
            method,
            url.pathname + url.search,
            createHash("sha256").update(payload).digest("hex"),
          ].join("\n"),
        )
        .digest("hex");
      const response = await fetch(url, {
        method,
        headers: {
          "x-djl-timestamp": timestamp,
          "x-djl-nonce": nonce,
          "x-djl-signature": signature,
          "content-type": "application/json",
        },
        body: body === undefined ? null : payload,
        redirect: "error",
        signal: AbortSignal.timeout(12_000),
      });
      if (response.status === 404)
        throw new ApiError(404, "not_found", "Server operation not found.");
      if (response.status === 400)
        throw new ApiError(
          409,
          "operation_refused",
          "Controller refused this operation. Refresh the service state before retrying.",
        );
      if (!response.ok) throw new Error("Controller refused request.");
      const text = await response.text();
      if (text.length > 1_000_000) throw new Error("Controller response too large.");
      return JSON.parse(text) as T;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(
        503,
        "controller_unavailable",
        "VPS controller is temporarily unavailable. Retry after checking service health.",
      );
    }
  }
}
