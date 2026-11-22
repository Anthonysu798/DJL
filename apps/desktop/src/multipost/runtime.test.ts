import { tmpdir } from "node:os";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { MultiPostRuntimeContext } from "@synara/contracts";
import { DesktopMultiPostRuntime } from "./runtime";

type HeaderRewrite = (
  details: { requestHeaders: Record<string, string> },
  callback: (result: { requestHeaders: Record<string, string> }) => void,
) => void;
const fixture = vi.hoisted(() => ({
  window: undefined as unknown as ReturnType<typeof createWindow>,
  options: [] as { webPreferences: Record<string, unknown> }[],
  rewriteHeaders: undefined as HeaderRewrite | undefined,
  notices: [] as { title: string; body: string }[],
}));
vi.mock("electron", () => ({
  app: {
    getName: () => "DJL",
    userAgentFallback: "Mozilla/5.0 Chrome/144.0.0.0 Electron/40.6.0 Safari/537.36",
    getPreferredSystemLanguages: () => ["en-CA", "en"],
    getLocale: () => "en-CA",
  },
  BrowserWindow: vi.fn(function (options: { webPreferences: Record<string, unknown> }) {
    fixture.options.push(options);
    return fixture.window;
  }),
  session: {
    fromPartition: () => ({
      setUserAgent: vi.fn(),
      setPermissionRequestHandler: vi.fn(),
      setPermissionCheckHandler: vi.fn(),
      webRequest: {
        onBeforeSendHeaders: (handler: HeaderRewrite) => {
          fixture.rewriteHeaders = handler;
        },
      },
    }),
  },
  net: { isOnline: () => true },
  powerMonitor: { on: vi.fn(), removeListener: vi.fn() },
  Notification: Object.assign(
    vi.fn(function (options: { title: string; body: string }) {
      fixture.notices.push(options);
      return { show: vi.fn() };
    }),
    { isSupported: () => true },
  ),
}));
const context = {
  scope: { workspaceId: "qa", threadId: "qa", authorizedRoot: "/private/tmp" },
  account: { id: "qa", platformKey: "instagram", label: "QA" },
  job: {
    id: "qa",
    adapterId: "DYNAMIC_INSTAGRAM",
    dueAt: new Date().toISOString(),
    target: {},
    snapshot: { data: { title: "QA" } },
  },
} as MultiPostRuntimeContext;
let runtime: DesktopMultiPostRuntime;
function createWindow() {
  const listeners = new Map<string, (...args: never[]) => void>();
  return {
    isDestroyed: () => false,
    destroy: vi.fn(),
    on: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
    loadURL: vi.fn((_url: string) => new Promise<void>(() => {})),
    /** Fires a page event the way Electron would. */
    emit: (event: string, ...args: unknown[]) =>
      (listeners.get(event) as ((...values: unknown[]) => void) | undefined)?.(...args),
    webContents: {
      getURL: () => "",
      isLoading: () => true,
      reload: vi.fn(),
      on: vi.fn((event: string, listener: (...args: never[]) => void) => {
        listeners.set(event, listener);
      }),
      setWindowOpenHandler: vi.fn(),
      debugger: {
        isAttached: () => true,
        sendCommand: vi.fn(async (_method: string, _params?: unknown) => {}),
      },
      stop: vi.fn(),
      executeJavaScript: vi.fn(async (_script: string): Promise<unknown> => true),
    },
  };
}
beforeEach(() => {
  fixture.notices.length = 0;
  fixture.options.length = 0;
  fixture.rewriteHeaders = undefined;
  fixture.window = createWindow();
  runtime = new DesktopMultiPostRuntime();
});
afterEach(() => {
  runtime.dispose();
  vi.useRealTimers();
});
it("opens an already-loading execution window without replacing its navigation", async () => {
  void runtime.open(context);
  await Promise.resolve();
  expect(fixture.window.loadURL).not.toHaveBeenCalled();
  expect(fixture.window.show).toHaveBeenCalledOnce();
});
it("bounds stalled platform navigation within the preparation deadline", async () => {
  vi.useFakeTimers();
  let failure: Error | undefined;
  void runtime.prepare(context).catch((error) => {
    failure = error;
  });
  await vi.advanceTimersByTimeAsync(120_001);
  expect(failure?.message).toMatch(/preparation timed out/i);
  expect(fixture.window.webContents.stop).toHaveBeenCalledOnce();
});
it("does not run preparation if navigation completes after its deadline", async () => {
  vi.useFakeTimers();
  let finish!: () => void;
  fixture.window.loadURL.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  void runtime.prepare(context).catch(() => {});
  await vi.advanceTimersByTimeAsync(120_001);
  finish();
  await vi.waitFor(() =>
    expect(fixture.window.webContents.executeJavaScript).toHaveBeenCalledTimes(1),
  );
  // Only the cancellation script may run, never a late adapter preparation.
  expect(fixture.window.webContents.executeJavaScript.mock.calls[0]?.[0]).toContain("?.cancel()");
  await vi.advanceTimersByTimeAsync(100);
  expect(fixture.window.webContents.executeJavaScript).toHaveBeenCalledTimes(1);
});
it("verifies the reopened execution page after a desktop restart", async () => {
  fixture.window.webContents.getURL = () => "https://www.instagram.com/p/qa_new/";
  fixture.window.webContents.executeJavaScript.mockResolvedValue({
    state: "published",
    postUrl: "https://www.instagram.com/p/qa_new/",
  });
  await runtime.open(context);
  await expect(runtime.verify(context)).resolves.toMatchObject({
    state: "published",
    postUrl: "https://www.instagram.com/p/qa_new/",
  });
});
it("waits for Instagram's asynchronous share confirmation without resubmitting", async () => {
  vi.useFakeTimers();
  fixture.window.webContents.getURL = () => "https://www.instagram.com/";
  fixture.window.webContents.executeJavaScript
    .mockResolvedValueOnce({ state: "uncertain" })
    .mockResolvedValue({ state: "published", message: "Instagram confirmed sharing." });
  await runtime.open(context);
  const result = runtime.verify({
    ...context,
    job: { ...context.job, submittedAt: new Date().toISOString() },
  });
  await vi.advanceTimersByTimeAsync(1000);
  await expect(result).resolves.toMatchObject({ state: "published" });
  expect(fixture.window.loadURL).not.toHaveBeenCalled();
});

const openSignIn = async () => {
  fixture.window.loadURL.mockResolvedValue(undefined);
  await runtime.connect(context.scope, context.account);
  const handler = fixture.window.webContents.setWindowOpenHandler.mock.calls[0]![0] as (details: {
    url: string;
    frameName: string;
    features: string;
    disposition: string;
  }) => {
    action: string;
    overrideBrowserWindowOptions?: { webPreferences: { partition: string } };
  };
  return { openWindow: handler };
};
const person = { provider: "instagram", accountId: "djl.app", username: "djl.app" };
it("gives a page that has only just opened a moment to draw before deciding nobody is signed in", async () => {
  vi.useFakeTimers();
  fixture.window.loadURL.mockResolvedValue(undefined);
  fixture.window.webContents.executeJavaScript
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce(null)
    .mockResolvedValue(person);
  const identity = runtime.identity(context.scope, context.account);
  await vi.advanceTimersByTimeAsync(5000);
  await expect(identity).resolves.toEqual(person);
  expect(fixture.window.webContents.executeJavaScript).toHaveBeenCalledTimes(3);
});
it("says in the log what the page showed when nobody is signed in", async () => {
  vi.useFakeTimers();
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    fixture.window.loadURL.mockResolvedValue(undefined);
    fixture.window.webContents.executeJavaScript.mockImplementation(async (script: string) =>
      script.includes("password") ? "a sign-in form" : null,
    );
    const identity = runtime.identity(context.scope, context.account);
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(identity).resolves.toBeNull();
    expect(warn.mock.calls.map((call) => call.join(" ")).join("\n")).toContain(
      "[multipost-page] instagram not signed in: a sign-in form",
    );
  } finally {
    warn.mockRestore();
  }
});
it("keeps passkey prompts, which a sign-in window cannot show, from stalling the page", async () => {
  await openSignIn();
  expect(fixture.options[0]!.webPreferences).toMatchObject({ disableBlinkFeatures: "WebAuth" });
});
it("tells sign-in pages it is desktop Chrome in every header, not only the user agent", async () => {
  await openSignIn();
  let sent: Record<string, string> = {};
  fixture.rewriteHeaders!(
    { requestHeaders: { "Sec-CH-UA": '"Chromium";v="144"', "user-agent": "Electron/40.6.0" } },
    (result) => {
      sent = result.requestHeaders;
    },
  );
  expect(sent["sec-ch-ua"]).toContain('"Google Chrome";v="144"');
  expect(sent["User-Agent"]).not.toMatch(/Electron|DJL/);
  expect(sent["Accept-Language"]).toBe("en-CA,en;q=0.9");
  expect(Object.keys(sent).filter((name) => /^sec-ch-ua$/i.test(name))).toHaveLength(1);
});
it("opens a verification popup as a real window on the same account so it can report back", async () => {
  const { openWindow } = await openSignIn();
  fixture.window.loadURL.mockClear();
  const result = openWindow({
    url: "https://www.facebook.com/dialog/oauth",
    frameName: "verify",
    features: "width=500,height=600",
    disposition: "new-window",
  });
  expect(result.action).toBe("allow");
  expect(result.overrideBrowserWindowOptions?.webPreferences.partition).toBe(
    fixture.options[0]!.webPreferences.partition,
  );
  expect(fixture.window.loadURL).not.toHaveBeenCalled();
});
it("follows an ordinary new-tab link inside the sign-in window", async () => {
  const { openWindow } = await openSignIn();
  const result = openWindow({
    url: "https://help.instagram.com/",
    frameName: "_blank",
    features: "",
    disposition: "foreground-tab",
  });
  expect(result.action).toBe("deny");
  expect(fixture.window.loadURL).toHaveBeenLastCalledWith("https://help.instagram.com/");
});
it("refuses to hand the sign-in window to a non-web address", async () => {
  const { openWindow } = await openSignIn();
  fixture.window.loadURL.mockClear();
  expect(
    openWindow({ url: "instagram://login", frameName: "", features: "", disposition: "default" })
      .action,
  ).toBe("deny");
  expect(fixture.window.loadURL).not.toHaveBeenCalled();
});
it("reloads a sign-in page that came up empty, but only once", async () => {
  vi.useFakeTimers();
  await openSignIn();
  fixture.window.webContents.getURL = () => "https://www.instagram.com/auth_platform/codeentry/";
  fixture.window.webContents.executeJavaScript.mockResolvedValue(true);
  fixture.window.emit("did-stop-loading");
  await vi.advanceTimersByTimeAsync(5000);
  expect(fixture.window.webContents.reload).toHaveBeenCalledOnce();
  fixture.window.emit("did-stop-loading");
  await vi.advanceTimersByTimeAsync(5000);
  expect(fixture.window.webContents.reload).toHaveBeenCalledOnce();
});
it("leaves a page with content alone", async () => {
  vi.useFakeTimers();
  await openSignIn();
  fixture.window.webContents.getURL = () => "https://www.instagram.com/";
  fixture.window.webContents.executeJavaScript.mockResolvedValue(false);
  fixture.window.emit("did-stop-loading");
  await vi.advanceTimersByTimeAsync(5000);
  expect(fixture.window.webContents.reload).not.toHaveBeenCalled();
});
it("records what went wrong on a sign-in page without the address's secrets", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    await openSignIn();
    fixture.window.emit(
      "did-fail-load",
      {},
      -105,
      "ERR_NAME_NOT_RESOLVED",
      "https://www.instagram.com/auth_platform/codeentry/?apc=secret-token",
      true,
    );
    fixture.window.emit("console-message", {
      level: "error",
      message: "Boom at https://www.instagram.com/x?token=secret-token",
    });
    const logged = warn.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(logged).toContain("https://www.instagram.com/auth_platform/codeentry/");
    expect(logged).toContain("ERR_NAME_NOT_RESOLVED");
    expect(logged).toContain("Boom");
    expect(logged).not.toContain("secret-token");
  } finally {
    warn.mockRestore();
  }
});
it("gives a brand-new posting window a page before attaching its helper script", async () => {
  const order: string[] = [];
  fixture.window.loadURL.mockImplementation(async (url: string) => {
    order.push(`load ${url}`);
  });
  fixture.window.webContents.debugger.sendCommand.mockImplementation(async () => {
    order.push("helper");
  });
  fixture.window.webContents.executeJavaScript.mockResolvedValue({ pending: 1, done: true });
  await runtime.prepare(context).catch(() => {});
  expect(order.slice(0, 2)).toEqual(["load about:blank", "helper"]);
});
it("makes the hidden posting page act focused before filling it, so typed captions are kept", async () => {
  // Instagram keeps a caption only when its box loses focus, and a hidden window never has focus.
  const order: string[] = [];
  fixture.window.loadURL.mockResolvedValue();
  fixture.window.webContents.debugger.sendCommand.mockImplementation(
    async (method: string, params?: unknown) => {
      order.push(`${method} ${JSON.stringify(params ?? {})}`);
    },
  );
  fixture.window.webContents.executeJavaScript.mockImplementation(async () => {
    order.push("adapter");
    return { pending: 1, done: true };
  });
  // The shared context's /private/tmp exists only on macOS; this test needs the whole prepare to run.
  await runtime.prepare({ ...context, scope: { ...context.scope, authorizedRoot: tmpdir() } });
  const focus = order.indexOf('Emulation.setFocusEmulationEnabled {"enabled":true}');
  expect(focus).toBeGreaterThan(-1);
  expect(focus).toBeLessThan(order.indexOf("adapter"));
});

const shared = (extra: Record<string, unknown> = {}) => ({
  ...context,
  account: { ...context.account, identity: { username: "djl.app" } },
  job: { ...context.job, submittedAt: "2026-11-20T07:05:51.000Z" },
  ...extra,
});
it("reports a shared Instagram post at once, without stopping to look for its link", async () => {
  fixture.window.webContents.executeJavaScript.mockResolvedValue({ state: "published" });
  await runtime.open(context);
  const evidence = await runtime.verify(shared() as MultiPostRuntimeContext);
  expect(evidence).toEqual({ state: "published" });
  expect(fixture.window.webContents.executeJavaScript).toHaveBeenCalledOnce();
});
it("finds a shared post's link on the person's own profile, checking it is the right post", async () => {
  fixture.window.loadURL.mockResolvedValue();
  fixture.window.webContents.executeJavaScript
    .mockResolvedValueOnce(["PINNED_OLD1", "DCnew_456"])
    .mockResolvedValueOnce("2026-01-01T00:00:00.000Z")
    .mockResolvedValueOnce("2026-11-20T07:05:55.000Z");
  await expect(runtime.postLink(shared() as MultiPostRuntimeContext)).resolves.toBe(
    "https://www.instagram.com/p/DCnew_456/",
  );
  expect(fixture.window.loadURL.mock.calls.map((call) => call[0])).toEqual([
    "https://www.instagram.com/djl.app/",
    "https://www.instagram.com/p/PINNED_OLD1/",
    "https://www.instagram.com/p/DCnew_456/",
    // The account's window goes back to where sign-in checks expect it.
    "https://www.instagram.com/",
  ]);
});
it("offers no link, and logs why, when the profile does not show the post yet", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    fixture.window.loadURL.mockResolvedValue();
    fixture.window.webContents.executeJavaScript
      .mockResolvedValueOnce(["OLDER_ONE1"])
      .mockResolvedValueOnce("2026-11-01T00:00:00.000Z");
    await expect(runtime.postLink(shared() as MultiPostRuntimeContext)).resolves.toBeNull();
    expect(warn.mock.calls.map((call) => call.join(" ")).join("\n")).toContain(
      "[multipost-page] instagram post link not found: 1 posts on the profile, none from this share",
    );
  } finally {
    warn.mockRestore();
  }
});
it("offers no link when the profile cannot be opened", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    fixture.window.loadURL.mockRejectedValue(new Error("ERR_INTERNET_DISCONNECTED"));
    await expect(runtime.postLink(shared() as MultiPostRuntimeContext)).resolves.toBeNull();
  } finally {
    warn.mockRestore();
  }
});
it("stops waiting for a profile that never finishes opening", async () => {
  vi.useFakeTimers();
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    const link = runtime.postLink(shared() as MultiPostRuntimeContext);
    await vi.advanceTimersByTimeAsync(21_000);
    await expect(link).resolves.toBeNull();
    expect(warn.mock.calls.map((call) => call.join(" ")).join("\n")).toContain(
      "post link not found: the profile did not open (took too long)",
    );
  } finally {
    warn.mockRestore();
  }
});
it("has no link to offer for a post that was never sent, or on another platform", async () => {
  await expect(
    runtime.postLink({ ...shared(), job: { ...context.job, submittedAt: null } } as never),
  ).resolves.toBeNull();
  await expect(
    runtime.postLink(
      shared({
        account: { ...context.account, platformKey: "x", identity: { username: "a" } },
      }) as never,
    ),
  ).resolves.toBeNull();
  expect(fixture.window.loadURL).not.toHaveBeenCalled();
});
it("shows a system notification in plain words when a post finishes", async () => {
  await runtime.notify({ kind: "posted", platformKey: "instagram", label: "@djl.app" });
  expect(fixture.notices).toEqual([{ title: "Your post is live", body: "@djl.app" }]);
});
