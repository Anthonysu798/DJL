import { HttpServerResponse } from "effect/unstable/http";
import { describe, expect, it, vi } from "vitest";

import { fromWebKeepingType } from "./routes.ts";

describe("finite authentication response forwarding", () => {
  it("materializes JSON before handing it to the HTTP adapter, preserving its MIME type", async () => {
    const upstream = Response.json({ authenticated: false });
    const converted = await fromWebKeepingType(upstream);
    expect(converted.body._tag).toBe("Uint8Array");
    expect(upstream.bodyUsed).toBe(true);
    const response = HttpServerResponse.toWeb(converted);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(await response.json()).toEqual({ authenticated: false });
  });

  it("preserves UTF-8 bytes, status and status text", async () => {
    const text = "登录成功 🍁";
    const converted = await fromWebKeepingType(
      new Response(text, {
        status: 201,
        statusText: "Created",
        headers: { "content-type": "text/plain; charset=utf-8" },
      }),
    );
    const response = HttpServerResponse.toWeb(converted);
    expect(response.status).toBe(201);
    expect(response.statusText).toBe("Created");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new TextEncoder().encode(text));
  });

  it("preserves separate session cookies and redirect headers", async () => {
    const headers = new Headers({ location: "/account", "cache-control": "no-store" });
    headers.append("set-cookie", "session=synthetic; Path=/; HttpOnly; SameSite=Lax");
    headers.append("set-cookie", "refresh=synthetic; Path=/; HttpOnly; SameSite=Lax");
    const upstream = new Response("Redirecting", { status: 302, headers });
    const response = HttpServerResponse.toWeb(await fromWebKeepingType(upstream));
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/account");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.getSetCookie()).toEqual([
      expect.stringContaining("session=synthetic"),
      expect.stringContaining("refresh=synthetic"),
    ]);
    expect(upstream.headers.getSetCookie()).toHaveLength(2);
    expect(await response.text()).toBe("Redirecting");
  });

  it("preserves binary responses without interpreting them as JSON", async () => {
    const bytes = new Uint8Array([0, 255, 1, 128]);
    const response = HttpServerResponse.toWeb(await fromWebKeepingType(new Response(bytes)));
    expect(response.headers.get("content-type")).toBe("application/octet-stream");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
  });

  it.each([204, 304])("keeps a bodyless %s response empty without reading it", async (status) => {
    const upstream = new Response(null, { status });
    const read = vi.spyOn(upstream, "arrayBuffer");
    const converted = await fromWebKeepingType(upstream);
    expect(converted.body._tag).toBe("Empty");
    expect(read).not.toHaveBeenCalled();
    const response = HttpServerResponse.toWeb(converted);
    expect(response.status).toBe(status);
    expect(response.body).toBeNull();
  });

  it("preserves an HTML authentication error response", async () => {
    const response = HttpServerResponse.toWeb(
      await fromWebKeepingType(
        new Response("<p>Sign-in failed</p>", {
          status: 400,
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
      ),
    );
    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(await response.text()).toBe("<p>Sign-in failed</p>");
  });

  it("rejects an unreadable body instead of handing off a successful lazy response", async () => {
    const error = new Error("Synthetic upstream body failure");
    const upstream = new Response(
      new ReadableStream({ start: (controller) => controller.error(error) }),
    );
    await expect(Promise.resolve(fromWebKeepingType(upstream))).rejects.toBe(error);
  });
});
