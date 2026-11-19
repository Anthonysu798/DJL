import { EventEmitter } from "node:events";
import https from "node:https";
import * as dns from "node:dns/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchPublicResource } from "./productSource";
vi.mock("node:dns/promises", () => ({ lookup: vi.fn() }));

function respond(
  status: number,
  headers: Record<string, string>,
  bytes: Buffer,
  observe?: (options: unknown) => void,
) {
  vi.spyOn(https, "request").mockImplementationOnce(((
    _url: unknown,
    options: unknown,
    callback: (response: unknown) => void,
  ) => {
    observe?.(options);
    const request = new EventEmitter() as EventEmitter & {
      end(): void;
      destroy(error: Error): void;
    };
    request.destroy = (error) => {
      request.emit("error", error);
      request.emit("close");
    };
    request.end = () =>
      queueMicrotask(() => {
        const response = new EventEmitter() as EventEmitter & {
          statusCode: number;
          headers: unknown;
          destroy(error: Error): void;
        };
        response.statusCode = status;
        response.headers = headers;
        response.destroy = (error) => {
          response.emit("error", error);
          request.emit("close");
        };
        callback(response);
        response.emit("data", bytes);
        response.emit("end");
        request.emit("close");
      });
    return request;
  }) as never);
}
afterEach(() => vi.restoreAllMocks());
describe("public product transport", () => {
  it("pins the validated address on the real transport lookup callback", async () => {
    let pinned = "";
    respond(200, { "content-type": "text/html" }, Buffer.from("<title>Lamp</title>"), (value) => {
      const options = value as {
        agent: boolean;
        lookup: (
          host: string,
          options: { all: boolean },
          callback: (error: unknown, addresses: { address: string }[]) => void,
        ) => void;
      };
      expect(options.agent).toBe(false);
      options.lookup("changed-hostname", { all: true }, (_error, addresses) => {
        pinned = addresses[0]!.address;
      });
    });
    const result = await fetchPublicResource("https://93.184.216.34/");
    expect(result.bytes.toString()).toContain("Lamp");
    expect(pinned).toBe("93.184.216.34");
  });
  it("rejects private DNS answers before connecting and pins public hostname resolution", async () => {
    const resolve = vi.mocked(dns.lookup);
    resolve.mockResolvedValueOnce([{ address: "10.0.0.1", family: 4 }] as never);
    const request = vi.spyOn(https, "request");
    await expect(fetchPublicResource("https://shop.example.com/product")).rejects.toThrow("public");
    expect(request).not.toHaveBeenCalled();
    resolve.mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }] as never);
    let pinned = "";
    respond(200, {}, Buffer.from("public"), (value) => {
      const options = value as {
        lookup: (
          host: string,
          options: { all: boolean },
          callback: (error: unknown, addresses: { address: string }[]) => void,
        ) => void;
      };
      options.lookup("shop.example.com", { all: true }, (_error, addresses) => {
        pinned = addresses[0]!.address;
      });
    });
    await fetchPublicResource("https://shop.example.com/product");
    expect(pinned).toBe("93.184.216.34");
    expect(resolve).toHaveBeenCalledTimes(2);
  });
  it("rejects a redirect to link-local metadata before a second request", async () => {
    respond(302, { location: "http://169.254.169.254/latest/meta-data" }, Buffer.alloc(0));
    await expect(fetchPublicResource("https://93.184.216.34/")).rejects.toThrow("public");
    expect(https.request).toHaveBeenCalledTimes(1);
  });
  it("rejects oversized bodies and HTTP errors", async () => {
    respond(200, { "content-type": "text/html" }, Buffer.alloc(30));
    await expect(fetchPublicResource("https://93.184.216.34/", 10)).rejects.toThrow("too large");
    vi.restoreAllMocks();
    respond(403, {}, Buffer.alloc(0));
    await expect(fetchPublicResource("https://93.184.216.34/")).rejects.toThrow("403");
  });
});
