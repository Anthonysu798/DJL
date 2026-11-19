import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const credentials = vi.hoisted(() => ({ url: "", token: "" }));
vi.mock("./desktopComputerCredentials", () => ({ desktopComputerCredentials: credentials }));
import { beginComputerUseTurn, isComputerActivityHistoryAuthorized } from "./computerTurnLifecycle";

describe("trusted computer-use turn authorization", () => {
  beforeEach(() => {
    credentials.url = "http://127.0.0.1:43210/computer-use";
    credentials.token = "private-desktop-token";
  });
  afterEach(() => vi.unstubAllGlobals());

  it("sends the trusted activity grant and explicitly revokes it on the next unselected turn", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json({ resumed: true }))
      .mockResolvedValueOnce(Response.json({ resumed: true }));
    vi.stubGlobal("fetch", fetch);
    expect(await beginComputerUseTurn("thread-a", { allowActivityHistory: true })).toBe(true);
    expect(isComputerActivityHistoryAuthorized("thread-a")).toBe(true);
    expect(await beginComputerUseTurn("thread-a", { allowActivityHistory: false })).toBe(true);
    expect(isComputerActivityHistoryAuthorized("thread-a")).toBe(false);
    expect(fetch.mock.calls.map(([, init]) => JSON.parse(init?.body as string))).toEqual([
      { threadId: "thread-a", allowActivityHistory: true },
      { threadId: "thread-a", allowActivityHistory: false },
    ]);
    const [url, init] = fetch.mock.calls[0]!;
    expect(String(url)).toBe("http://127.0.0.1:43210/computer-use/turn-start");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer private-desktop-token");
    expect(init?.redirect).toBe("error");
  });

  it("fails closed when the bridge is unavailable or rejects turn-start", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json({ resumed: true }, { status: 403 }))
      .mockResolvedValueOnce(Response.json({ resumed: "true" }))
      .mockRejectedValueOnce(new Error("private network detail"));
    vi.stubGlobal("fetch", fetch);
    for (let i = 0; i < 3; i++) {
      expect(await beginComputerUseTurn("thread-a", { allowActivityHistory: true })).toBe(false);
      expect(isComputerActivityHistoryAuthorized("thread-a")).toBe(false);
    }
    credentials.token = "";
    expect(await beginComputerUseTurn("thread-a", { allowActivityHistory: true })).toBe(false);
    expect(isComputerActivityHistoryAuthorized("thread-a")).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("revokes synchronously and stays revoked when the revoke request fails", async () => {
    let rejectRevoke!: (error: Error) => void;
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json({ resumed: true }))
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            rejectRevoke = reject;
          }),
      );
    vi.stubGlobal("fetch", fetch);
    await beginComputerUseTurn("thread-failed-revoke", { allowActivityHistory: true });
    expect(isComputerActivityHistoryAuthorized("thread-failed-revoke")).toBe(true);
    const revoke = beginComputerUseTurn("thread-failed-revoke", { allowActivityHistory: false });
    expect(isComputerActivityHistoryAuthorized("thread-failed-revoke")).toBe(false);
    rejectRevoke(new Error("private network error"));
    expect(await revoke).toBe(false);
    expect(isComputerActivityHistoryAuthorized("thread-failed-revoke")).toBe(false);
  });

  it("does not let a late older grant override a newer unselected turn", async () => {
    let finishOlderGrant!: (response: Response) => void;
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishOlderGrant = resolve;
          }),
      )
      .mockResolvedValueOnce(Response.json({ resumed: true }));
    vi.stubGlobal("fetch", fetch);
    const olderGrant = beginComputerUseTurn("thread-overlap", { allowActivityHistory: true });
    expect(isComputerActivityHistoryAuthorized("thread-overlap")).toBe(false);
    expect(await beginComputerUseTurn("thread-overlap", { allowActivityHistory: false })).toBe(
      true,
    );
    finishOlderGrant(Response.json({ resumed: true }));
    expect(await olderGrant).toBe(true);
    expect(isComputerActivityHistoryAuthorized("thread-overlap")).toBe(false);
  });

  it.each([
    "https://example.com/computer-use",
    "http://user:pass@127.0.0.1:43210/computer-use",
    "http://127.0.0.1:43210/computer-use?x=1",
  ])("does not send a grant to untrusted endpoint %s", async (url) => {
    credentials.url = url;
    const fetch = vi.fn<typeof globalThis.fetch>();
    vi.stubGlobal("fetch", fetch);
    expect(await beginComputerUseTurn("thread-a", { allowActivityHistory: true })).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
});
