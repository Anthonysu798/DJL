import {
  BROWSER_BLANK_URL,
  buildAcceptLanguageHeader,
  buildChromeClientHints,
  classifyBrowserWindowOpen,
  deriveChromeUserAgent,
} from "@synara/shared/browserSession";
import { app } from "electron";
import { createHash } from "node:crypto";
import { BrowserWindow, Notification, session, net, powerMonitor } from "electron";
import { realpath, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type {
  MultiPostBrowserRuntime,
  MultiPostAccount,
  MultiPostScope,
  MultiPostIdentity,
  MultiPostRuntimeContext,
  MultiPostEvidence,
  MultiPostContentData,
  MultiPostNotice,
} from "@synara/contracts";
import { noticeText } from "./notice";
import {
  INSTAGRAM_GRID_SCRIPT,
  INSTAGRAM_POST_TIME_SCRIPT,
  gridCodes,
  madeByThisShare,
} from "./postLink";
import {
  adapters,
  getAdapter,
  helperSource,
  webhookMessage,
  identitySources,
} from "@synara/multipost";
import {
  buildPreparationScript,
  buildSubmissionScript,
  buildIdentityScript,
  buildVerificationScript,
  buildNativeScheduleVerificationScript,
  buildCancelScript,
} from "@synara/multipost/browser";
import { multipostPartition } from "./identity";

/** Query strings carry sign-in tokens, so logs keep only where a page is. */
const withoutSecrets = (text: string) => text.replace(/[?#][^\s"')]*/g, "");
/** What a page with no signed-in person on it is showing, for the log. Reads nothing personal. */
const NOT_SIGNED_IN_SCRIPT = `document.querySelector('input[type="password"]') ? "a sign-in form" : "no account menu on " + location.pathname + (document.querySelector('[role="dialog"]') ? ", with a message open" : "")`;
/** True when a finished page shows nothing a person could read or press. */
const BLANK_PAGE_SCRIPT = `(() => {
  if (!document.body) return true;
  if (document.body.innerText.trim()) return false;
  return ![...document.querySelectorAll("img,video,canvas,iframe,input,button")].some((element) => {
    const box = element.getBoundingClientRect();
    return box.width > 40 && box.height > 40;
  });
})()`;

/** Social sessions are separate from both normal browsing and each other. */
export class DesktopMultiPostRuntime implements MultiPostBrowserRuntime {
  private readonly windows = new Map<string, BrowserWindow>();
  private readonly prepared = new Map<string, BrowserWindow>();
  private resumedAt = 0;
  private readonly onResume = () => {
    this.resumedAt = Date.now();
  };
  constructor() {
    powerMonitor.on("resume", this.onResume);
  }
  async available() {
    return net.isOnline();
  }
  private key(scope: MultiPostScope, account: MultiPostAccount) {
    return multipostPartition(scope.workspaceId, account.id);
  }
  private window(scope: MultiPostScope, account: MultiPostAccount, jobId?: string) {
    const partition = this.key(scope, account);
    const key = jobId ? `${partition}:${jobId}` : partition;
    const existing = this.windows.get(key);
    if (existing && !existing.isDestroyed()) return existing;
    const partitionSession = session.fromPartition(partition);
    const userAgent = deriveChromeUserAgent(app.userAgentFallback, [app.getName()]);
    partitionSession.setUserAgent(userAgent);
    // `setUserAgent` leaves the client hints saying "Electron"; sign-in pages read both, and a
    // mismatch is treated as an automated browser.
    const identity = {
      "User-Agent": userAgent,
      ...buildChromeClientHints(userAgent, process.platform),
      ...((language) => (language ? { "Accept-Language": language } : {}))(
        buildAcceptLanguageHeader(app.getPreferredSystemLanguages()),
      ),
    };
    const replaced = new Set(Object.keys(identity).map((name) => name.toLowerCase()));
    partitionSession.webRequest.onBeforeSendHeaders((details, callback) => {
      const requestHeaders = Object.fromEntries(
        Object.entries(details.requestHeaders).filter(
          ([name]) => !replaced.has(name.toLowerCase()),
        ),
      );
      callback({ requestHeaders: { ...requestHeaders, ...identity } });
    });
    partitionSession.setPermissionRequestHandler((_contents, _permission, callback) =>
      callback(false),
    );
    partitionSession.setPermissionCheckHandler(() => false);
    const webPreferences = {
      partition,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      // These windows have no passkey prompt, so a page that starts one waits forever.
      // Without the API, sites fall back to a password or an emailed code.
      disableBlinkFeatures: "WebAuth",
    };
    const window = new BrowserWindow({
      width: 1100,
      height: 800,
      show: false,
      title: `DJL MultiPost — ${account.label}`,
      webPreferences,
    });
    window.webContents.setWindowOpenHandler((details) => {
      const { url } = details;
      if (!url.startsWith("https://") && url !== BROWSER_BLANK_URL) return { action: "deny" };
      // A verification or "continue with" popup talks back to the page that opened it, so it
      // has to be a real child window; replacing the page would leave both sides waiting.
      if (classifyBrowserWindowOpen(details) === "popup")
        return {
          action: "allow",
          overrideBrowserWindowOptions: { width: 520, height: 720, parent: window, webPreferences },
        };
      void window.loadURL(url);
      return { action: "deny" };
    });
    this.watch(window, account.platformKey, !jobId);
    window.on("closed", () => {
      this.windows.delete(key);
      for (const [id, owner] of this.prepared) if (owner === window) this.prepared.delete(id);
    });
    this.windows.set(key, window);
    return window;
  }
  /** Writes what a platform page did to the desktop log, so a failed sign-in can be explained. */
  private watch(window: BrowserWindow, platform: string, signIn: boolean) {
    const contents = window.webContents;
    const log = (...parts: unknown[]) =>
      console.warn(
        "[multipost-page]",
        platform,
        ...parts.map((part) => withoutSecrets(String(part))),
      );
    contents.on("did-navigate", (_event, url, status) => log("opened", status, url));
    contents.on("did-fail-load", (_event, code, description, url, isMainFrame) => {
      // -3 is a navigation the page itself replaced, not a failure.
      if (code !== -3)
        log(isMainFrame ? "failed to load" : "frame failed to load", code, description, url);
    });
    contents.on("render-process-gone", (_event, details) => log("crashed", details.reason));
    contents.on("console-message", (event) => {
      if (event.level === "error") log("page error", event.message.slice(0, 300));
    });
    contents.on("did-create-window", (child) => this.watch(child, platform, false));
    if (!signIn) return;
    // A sign-in step that renders nothing leaves a person stuck with no reload button.
    const reloaded = new Set<string>();
    contents.on("did-stop-loading", () => {
      setTimeout(() => {
        if (window.isDestroyed()) return;
        const page = withoutSecrets(contents.getURL());
        if (!page.startsWith("https://")) return;
        void contents
          .executeJavaScript(BLANK_PAGE_SCRIPT)
          .then((blank) => {
            if (!blank) return;
            if (reloaded.has(page)) return log("still blank after reload", page);
            reloaded.add(page);
            log("blank page, reloading", page);
            contents.reload();
          })
          .catch(() => {});
      }, 4000);
    });
  }
  async connect(scope: MultiPostScope, account: MultiPostAccount) {
    const window = this.window(scope, account);
    if (account.platformKey === "webhook") {
      await window.loadURL("about:blank");
      window.show();
      return;
    }
    if (!window.webContents.getURL()) {
      const platform = adapters.find((x) => x.platformKey === account.platformKey);
      if (!platform) throw new Error("Unknown platform");
      await window.loadURL(account.homeUrl ?? platform.homeUrl);
    }
    window.show();
    window.focus();
  }
  async identity(
    scope: MultiPostScope,
    account: MultiPostAccount,
  ): Promise<MultiPostIdentity | null> {
    if (account.platformKey === "webhook" && account.homeUrl) {
      const url = new URL(account.homeUrl);
      return {
        provider: "webhook",
        accountId: createHash("sha256").update(account.homeUrl).digest("hex"),
        username: url.hostname,
        verifiedAt: new Date().toISOString(),
      };
    }
    const window = this.window(scope, account);
    const opened = !window.webContents.getURL();
    if (opened) {
      const adapter = adapters.find((x) => x.platformKey === account.platformKey);
      if (adapter) await window.loadURL(account.homeUrl ?? adapter.homeUrl);
    }
    // DOM identities must be refreshed: a cached profile link can outlive a cookie/account change.
    if (!identitySources[account.platformKey]) {
      const url = window.webContents.getURL();
      if (url) await window.loadURL(url);
    }
    const script = buildIdentityScript(account.platformKey);
    let identity = (await window.webContents.executeJavaScript(script)) as MultiPostIdentity | null;
    // A page that has only just opened may not have drawn its menu yet.
    for (let attempt = opened ? 0 : 6; !identity && attempt < 6; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 700));
      if (window.isDestroyed()) return null;
      identity = (await window.webContents.executeJavaScript(script)) as MultiPostIdentity | null;
    }
    if (!identity)
      console.warn(
        "[multipost-page]",
        account.platformKey,
        "not signed in:",
        withoutSecrets(
          String(
            await window.webContents.executeJavaScript(NOT_SIGNED_IN_SCRIPT).catch(() => "unknown"),
          ),
        ),
      );
    return identity;
  }
  private async content(context: MultiPostRuntimeContext): Promise<MultiPostContentData> {
    const data = structuredClone({ ...context.job.snapshot.data, ...context.job.target.overrides });
    const root = await realpath(context.scope.authorizedRoot);
    const convert = async (file: { name: string; url: string; type?: string; size?: number }) => {
      const url = file.url;
      if (url.startsWith("https://")) {
        const response = await net.fetch(url, {
          credentials: "omit",
          redirect: "error",
          signal: AbortSignal.timeout(120000),
        });
        if (!response.ok) throw new Error("Media URL could not be fetched");
        if (Number(response.headers.get("Content-Length") ?? 0) > 100 * 1024 * 1024)
          throw new Error("Media exceeds 100 MiB");
        const buffer = Buffer.from(await response.arrayBuffer());
        if (buffer.length > 100 * 1024 * 1024) throw new Error("Media exceeds 100 MiB");
        return {
          ...file,
          type: file.type ?? response.headers.get("Content-Type") ?? "application/octet-stream",
          url: `data:${file.type ?? response.headers.get("Content-Type") ?? "application/octet-stream"};base64,${buffer.toString("base64")}`,
        };
      }
      if (url.startsWith("data:")) {
        if (url.length > 4 * 1024 * 1024) throw new Error("Inline media exceeds 4 MiB");
        return file;
      }
      if (/^[a-z][a-z0-9+.-]*:/i.test(url))
        throw new Error("Use an authorized local path or HTTPS media URL");
      const media = url.startsWith("Media/") && context.scope.mediaRoot;
      const mediaRoot = media ? await realpath(media) : root;
      const full = await realpath(path.resolve(mediaRoot, media ? url.slice(6) : url));
      if (!full.startsWith(mediaRoot + path.sep))
        throw new Error("Media is outside the authorized workspace");
      const info = await stat(full);
      if (info.size > 100 * 1024 * 1024) throw new Error("Media exceeds 100 MiB");
      const bytes = await readFile(full);
      return {
        ...file,
        size: info.size,
        url: `data:${file.type ?? "application/octet-stream"};base64,${bytes.toString("base64")}`,
      };
    };
    for (const key of ["images", "videos"] as const)
      if (data[key]) data[key] = await Promise.all(data[key]!.map(convert));
    for (const key of [
      "video",
      "audio",
      "cover",
      "verticalCover",
      "horizontalCover",
      "wordFileData",
    ] as const)
      if (data[key]) data[key] = await convert(data[key]!);
    return data;
  }
  async prepare(
    context: MultiPostRuntimeContext,
    signal?: AbortSignal,
  ): Promise<MultiPostEvidence> {
    const { scope, account, job } = context;
    if (Date.parse(job.dueAt) < this.resumedAt)
      return {
        state: "missed",
        message: "Task missed while the computer was asleep. Review before retrying.",
        observedAt: new Date().toISOString(),
      };
    const adapter = getAdapter(job.adapterId);
    if (adapter.platformKey !== account.platformKey) throw new Error("Account/adapter mismatch");
    const window = this.window(scope, account, job.id);
    const extra =
      account.platformKey === "webhook" && account.homeUrl
        ? { ...job.target.extraConfig, urls: [account.homeUrl] }
        : (job.target.extraConfig ?? {});
    const custom = extra.customInjectUrls;
    if (
      custom !== undefined &&
      (!Array.isArray(custom) || custom.length > 1 || typeof custom[0] !== "string")
    )
      throw new Error("Select one custom destination per target");
    const url =
      Array.isArray(custom) && custom.length
        ? (custom[0] as string)
        : (account.homeUrl ?? adapter.injectUrl);
    const destination = new URL(url);
    if (
      destination.protocol !== "https:" &&
      !(
        destination.protocol === "http:" &&
        ["127.0.0.1", "localhost", "[::1]"].includes(destination.hostname)
      )
    )
      throw new Error("Publishing destinations must use HTTPS or local loopback");
    let cancelled = signal?.aborted ?? false;
    const abort = () => {
      cancelled = true;
      void window.webContents.executeJavaScript(buildCancelScript()).catch(() => {});
      window.webContents.stop();
    };
    signal?.addEventListener("abort", abort, { once: true });
    if (account.platformKey === "webhook") {
      await window.loadURL("about:blank");
      this.prepared.set(job.id, window);
      const title = JSON.stringify(job.snapshot.data.title);
      const caption = JSON.stringify(
        job.target.overrides?.content ?? job.snapshot.data.content ?? "",
      );
      await window.webContents.executeJavaScript(
        `document.body.textContent=${title}+"\\n"+${caption};`,
      );
      return {
        state: "prepared",
        requiresManual: false,
        message: "Webhook text prepared; no request has been sent.",
        observedAt: new Date().toISOString(),
      };
    }
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      if (signal?.aborted) throw new Error("Publishing cancelled");
      const result = (await Promise.race([
        (async () => {
          // A window that has never loaded anything has no page for the debugger to answer
          // from, and the helper registration below would wait forever.
          if (!window.webContents.getURL()) await window.loadURL(BROWSER_BLANK_URL);
          if (cancelled) throw new Error("Publishing cancelled");
          if (!window.webContents.debugger.isAttached()) window.webContents.debugger.attach("1.3");
          await window.webContents.debugger.sendCommand("Page.addScriptToEvaluateOnNewDocument", {
            source: helperSource,
          });
          // A hidden window never has focus, so its pages get no focus or blur events, and
          // Instagram only keeps a caption when its box loses focus: posts went out blank.
          await window.webContents.debugger.sendCommand("Emulation.setFocusEmulationEnabled", {
            enabled: true,
          });
          await window.loadURL(url);
          if (cancelled) throw new Error("Publishing cancelled");
          const data = await this.content(context);
          if (cancelled) throw new Error("Publishing cancelled");
          return window.webContents.executeJavaScript(
            buildPreparationScript(adapter.id, data, extra),
          );
        })(),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => {
            abort();
            reject(new Error("Platform preparation timed out; inspect the account window"));
          }, 120_000);
        }),
      ])) as { pending: number; done: boolean };
      if (signal?.aborted) throw new Error("Publishing cancelled");
      this.prepared.set(job.id, window);
      return {
        state: "prepared",
        requiresManual: !result.pending,
        message: result.pending
          ? "Content prepared; host authorization required before submission."
          : "Content filled. Complete the final platform steps in the account window.",
        observedAt: new Date().toISOString(),
      };
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
    }
  }
  async open(context: MultiPostRuntimeContext) {
    const window =
      this.prepared.get(context.job.id) ??
      this.window(context.scope, context.account, context.job.id);
    window.show();
    window.focus();
    if (!window.webContents.getURL() && !window.webContents.isLoading())
      await window.loadURL(getAdapter(context.job.adapterId).injectUrl);
  }
  async close(context: MultiPostRuntimeContext) {
    const window = this.prepared.get(context.job.id);
    window?.close();
    this.prepared.delete(context.job.id);
  }
  async submit(context: MultiPostRuntimeContext, signal?: AbortSignal): Promise<MultiPostEvidence> {
    if (Date.parse(context.job.dueAt) < this.resumedAt)
      return {
        state: "missed",
        message: "Computer resumed after this task was due. Review before retrying.",
        observedAt: new Date().toISOString(),
      };
    if (signal?.aborted) throw new Error("Publishing cancelled");
    const window = this.prepared.get(context.job.id);
    if (!window || window.isDestroyed()) throw new Error("Prepared page is no longer available");
    if (context.account.platformKey === "webhook") {
      const urls = context.job.target.extraConfig?.urls;
      const url =
        Array.isArray(urls) && typeof urls[0] === "string" ? urls[0] : context.account.homeUrl;
      if (!url) throw new Error("Configure a webhook destination");
      const parsed = new URL(url);
      if (
        parsed.protocol !== "https:" &&
        !(
          parsed.protocol === "http:" &&
          ["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname)
        )
      )
        throw new Error("Unsupported webhook destination");
      const body = webhookMessage(
        url,
        context.job.target.overrides?.title ?? context.job.snapshot.data.title,
        context.job.target.overrides?.content ?? context.job.snapshot.data.content ?? "",
      );
      const response = await net.fetch(url, {
        method: "POST",
        credentials: "omit",
        redirect: "error",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: signal ?? AbortSignal.timeout(30000),
      });
      if (!response.ok) throw new Error(`Webhook returned HTTP ${response.status}`);
      const text = await response.text();
      let result: Record<string, unknown> = {};
      try {
        result = JSON.parse(text);
      } catch {}
      if (typeof result.errcode === "number" && result.errcode !== 0)
        throw new Error("Webhook rejected the message");
      const postUrl = result.postUrl ?? result.post_url ?? result.permalink;
      return typeof postUrl === "string"
        ? { state: "published", postUrl, observedAt: new Date().toISOString() }
        : {
            state: "delivered",
            message: "Webhook acknowledged delivery; no public post link was returned.",
            observedAt: new Date().toISOString(),
          };
    }
    const abort = () => {
      void window.webContents.executeJavaScript(buildCancelScript()).catch(() => {});
    };
    signal?.addEventListener("abort", abort, { once: true });
    try {
      const sent = (await window.webContents.executeJavaScript(buildSubmissionScript())) as {
        dispatched: boolean;
      };
      if (!sent.dispatched)
        return {
          state: "prepared",
          requiresManual: true,
          dispatched: false,
          message: "This platform requires final manual steps in its execution page.",
          observedAt: new Date().toISOString(),
        };
    } finally {
      signal?.removeEventListener("abort", abort);
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
    return this.verify(context);
  }
  async verify(context: MultiPostRuntimeContext): Promise<MultiPostEvidence> {
    const window =
      this.prepared.get(context.job.id) ??
      this.windows.get(`${this.key(context.scope, context.account)}:${context.job.id}`);
    if (!window || window.isDestroyed())
      return {
        state: "uncertain",
        message: "Open the platform to verify this submission.",
        observedAt: new Date().toISOString(),
      };
    const script = buildVerificationScript({
      adapterId: context.job.adapterId,
      ...(context.account.identity ? { username: context.account.identity.username } : {}),
      submittedAt: context.job.submittedAt,
      data: { ...context.job.snapshot.data, ...context.job.target.overrides },
    });
    let evidence = (await window.webContents.executeJavaScript(script)) as MultiPostEvidence;
    if (context.account.platformKey === "instagram" && context.job.submittedAt) {
      for (let attempt = 0; evidence.state === "uncertain" && attempt < 30; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        if (window.isDestroyed()) break;
        evidence = (await window.webContents.executeJavaScript(script)) as MultiPostEvidence;
      }
    }
    if (
      evidence.state === "uncertain" &&
      (context.job.target.overrides?.scheduledPublishTime ??
        context.job.snapshot.data.scheduledPublishTime)
    ) {
      const accepted = await window.webContents.executeJavaScript(
        buildNativeScheduleVerificationScript(),
      );
      if (accepted)
        return {
          state: "scheduled-on-platform",
          message: "Platform acknowledged the native schedule.",
          observedAt: new Date().toISOString(),
        };
    }
    return evidence;
  }
  /** Where a shared post ended up, read from the person's own profile once the share is confirmed. */
  async postLink(context: MultiPostRuntimeContext): Promise<string | null> {
    const { account, job, scope } = context;
    const username = account.identity?.username;
    if (account.platformKey !== "instagram" || !job.submittedAt || !username) return null;
    const home = "https://www.instagram.com/";
    const window = this.window(scope, account);
    const read = (script: string) =>
      window.webContents.executeJavaScript(script) as Promise<unknown>;
    let seen = "the profile did not open";
    // With no connection a page can load forever; the link is not worth waiting for.
    const open = (url: string) =>
      Promise.race([
        window.loadURL(url),
        new Promise<never>((_resolve, reject) =>
          setTimeout(() => reject(new Error("took too long")), 20_000),
        ),
      ]);
    try {
      await open(home + encodeURIComponent(username) + "/");
      const codes = gridCodes(await read(INSTAGRAM_GRID_SCRIPT));
      seen = `${codes.length} posts on the profile, none from this share`;
      for (const code of codes) {
        const url = `${home}p/${code}/`;
        await open(url);
        const postedAt = await read(INSTAGRAM_POST_TIME_SCRIPT);
        if (madeByThisShare(postedAt, job.submittedAt)) return url;
        // How far off each one was explains a miss without naming any post.
        seen += `, ${typeof postedAt === "string" ? Math.round((Date.parse(postedAt) - Date.parse(job.submittedAt)) / 1000) + "s" : "no time"}`;
      }
    } catch (error) {
      seen += ` (${withoutSecrets(error instanceof Error ? error.message : String(error))})`;
    } finally {
      if (!window.isDestroyed()) void window.loadURL(home).catch(() => {});
    }
    console.warn("[multipost-page]", "instagram", `post link not found: ${seen}`);
    return null;
  }
  async notify(notice: MultiPostNotice) {
    if (!Notification.isSupported()) return;
    new Notification(noticeText(notice, app.getLocale())).show();
  }
  async cancel(context: MultiPostRuntimeContext): Promise<MultiPostEvidence> {
    const window = this.prepared.get(context.job.id);
    if (window && !window.isDestroyed())
      await window.webContents.executeJavaScript(buildCancelScript()).catch(() => {});
    return {
      state: "uncertain",
      message: "Platform cancellation is not confirmed. Open the account window to inspect it.",
      observedAt: new Date().toISOString(),
    };
  }
  async disconnect(scope: MultiPostScope, account: MultiPostAccount) {
    const key = this.key(scope, account);
    for (const [id, window] of this.windows)
      if (id === key || id.startsWith(key + ":")) window.destroy();
    await session.fromPartition(key).clearStorageData();
  }
  dispose() {
    powerMonitor.removeListener("resume", this.onResume);
    for (const window of this.windows.values()) if (!window.isDestroyed()) window.destroy();
    this.windows.clear();
    this.prepared.clear();
  }
}
