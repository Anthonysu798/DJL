import { afterEach, describe, expect, it, vi } from "vitest";
import { createCloudClient } from "./api";

afterEach(() => vi.useRealTimers());
const limited = (message = "Too many requests. Retry in 2s.", headers = {}) =>
  new Response(JSON.stringify({ error: { code: "rate_limited", message } }), {
    status: 429,
    headers,
  });

describe("Cloud streaming admission retries", () => {
  it.each([
    ["gateway delay", {}, 2000],
    ["Retry-After seconds", { "retry-after": "3" }, 3000],
    ["Retry-After date", { "retry-after": "Sun, 01 Nov 2026 12:00:04 GMT" }, 4000],
  ])("honors %s before retrying an unstarted stream", async (_name, headers, delay) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-01T12:00:00Z"));
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(limited(undefined, headers))
      .mockResolvedValueOnce(new Response("stream"));
    const result = createCloudClient("https://cloud.test", fetch).stream(
      "/v1/chat/completions",
      { model: "test" },
      "synthetic",
      new AbortController().signal,
    );
    await vi.advanceTimersByTimeAsync(Number(delay) - 1);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect((await result).status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1]).toEqual(fetch.mock.calls[0]);
  });

  it("bounds repeated rate limits and refuses waits over a minute", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockImplementation(async () => limited());
    const result = createCloudClient("https://cloud.test", fetch).stream(
      "/v1/chat/completions",
      {},
      "synthetic",
      new AbortController().signal,
    );
    const assertion = expect(result).rejects.toMatchObject({ detail: { status: 429 } });
    await vi.runAllTimersAsync();
    await assertion;
    expect(fetch).toHaveBeenCalledTimes(3);
    fetch.mockClear().mockImplementation(async () => limited(undefined, { "retry-after": "120" }));
    await expect(
      createCloudClient("https://cloud.test", fetch).stream(
        "/v1/chat/completions",
        {},
        "synthetic",
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ detail: { status: 429 } });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("cancels a pending retry without another request", async () => {
    vi.useFakeTimers();
    const controller = new AbortController(),
      fetch = vi.fn().mockImplementation(async () => limited());
    const result = createCloudClient("https://cloud.test", fetch).stream(
      "/v1/chat/completions",
      {},
      "synthetic",
      controller.signal,
    );
    const assertion = expect(result).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(1);
    controller.abort();
    await vi.runAllTimersAsync();
    await assertion;
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    [429, "usage_window_exhausted"],
    [401, "unauthorized"],
    [402, "insufficient_credits"],
    [503, "unavailable"],
  ])("does not retry %s %s", async (status, code) => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ error: { code, message: "failed" } }), { status }),
      );
    await expect(
      createCloudClient("https://cloud.test", fetch).stream(
        "/v1/chat/completions",
        {},
        "synthetic",
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ detail: { status, code } });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
