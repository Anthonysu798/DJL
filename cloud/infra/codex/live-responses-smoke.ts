// Isolated live protocol proxy. It has only the bounded provider key, never database credentials.
import { validateResponseRequest } from "../../packages/providers/src/responses.ts";
let calls = 0;
const token = process.env.CODEX_BROKER_TOKEN!;
if (!token || !process.env.OPENROUTER_API_KEY) throw new Error("Missing smoke credentials");
Bun.serve({
  port: 8090,
  hostname: "0.0.0.0",
  maxRequestBodySize: 6 * 1024 * 1024,
  async fetch(request) {
    if (
      new URL(request.url).pathname !== "/v1/responses" ||
      request.headers.get("authorization") !== `Bearer ${token}`
    )
      return new Response(null, { status: 401 });
    if (++calls > 4) return new Response(null, { status: 429 });
    const raw = (await request.json()) as Record<string, unknown>;
    console.log(
      JSON.stringify({
        toolTypes: Array.isArray(raw.tools) ? raw.tools.map((t: { type: string }) => t.type) : [],
      }),
    );
    const body: Record<string, unknown> = { ...validateResponseRequest(raw) };
    body.model = "nvidia/nemotron-3.5-lightning:free";
    body.max_output_tokens = 2048;
    body.store = false;
    body.stream = true;
    const response = await fetch("https://openrouter.ai/api/v1/responses", {
      method: "POST",
      headers: {
        authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "content-type": "application/json",
        "X-Title": "DJL isolated Codex smoke",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(60_000)]),
    });
    console.log(
      JSON.stringify({ call: calls, status: response.status, fields: Object.keys(body) }),
    );
    return new Response(response.body, {
      status: response.status,
      headers: { "content-type": response.headers.get("content-type") ?? "application/json" },
    });
  },
});
