import { afterEach, describe, it, expect } from "vitest";
import { adapterSources } from "./index";
import { buildPreparationScript, buildSubmissionScript } from "./browser";
import selectors from "./fixtures.json";
import labels from "./fixtureLabels.json";
import { helperSource } from "./index";
const frames: HTMLIFrameElement[] = [];
afterEach(() => {
  for (const frame of frames.splice(0)) frame.remove();
});
function selectorParts(value: string) {
  let quote = "",
    depth = 0,
    current = "";
  const parts: string[] = [];
  for (const char of value) {
    if ((char === '"' || char === "'") && (!quote || quote === char)) quote = quote ? "" : char;
    if (!quote) {
      if (char === "[") depth++;
      if (char === "]") depth--;
      if (depth === 0 && (/\s/.test(char) || char === ">")) {
        if (current) parts.push(current);
        current = "";
        continue;
      }
    }
    current += char;
  }
  if (current) parts.push(current);
  return parts;
}
function fixtureDocument(doc: Document, selectors: string[], texts: string[]) {
  const root = doc.createElement("main");
  doc.body.append(root);
  for (const selectorList of selectors) {
    if (/geetest|captcha/i.test(selectorList)) continue; // This fixture models a signed-in page without a challenge.

    for (const selector of selectorList.split(/,(?![^[]*\])/)) {
      let parent: Element = root;
      for (let part of selectorParts(selector.trim())) {
        if (!part || [">", "+", "~"].includes(part)) continue;
        part = part
          .replace(/:(?:not|is|where|has)\([^)]*\)/g, "")
          .replace(/:[\w-]+(?:\([^)]*\))?/g, "");
        const tag =
          /^[a-z][a-z0-9-]*/i.exec(part)?.[0] ??
          (/title|placeholder|input|type=/.test(part) && !/contenteditable|editor/.test(part)
            ? "input"
            : "div");
        let element: HTMLElement;
        try {
          element = doc.createElement(tag);
        } catch {
          continue;
        }
        for (const match of part.matchAll(/\.([\w-]+)/g)) element.classList.add(match[1]!);
        const id = /#([\w-]+)/.exec(part)?.[1];
        if (id) element.id = id;
        for (const match of part.matchAll(
          /\[([^\s~|^$*=\]]+)(?:[~|^$*]?=\s*["']?([^"'\]]*)["']?)?\]/g,
        ))
          try {
            element.setAttribute(match[1]!, match[2] ?? "");
          } catch {}
        if (/editor|contenteditable|textbox|prosemirror|ql-editor/i.test(part))
          element.contentEditable = "true";
        if (tag === "input" && !(element as HTMLInputElement).type)
          (element as HTMLInputElement).type = "text";
        if (tag === "button") element.textContent = "Open";
        parent.append(element);
        parent = element;
      }
    }
  }
  for (const text of [
    ...texts,
    "写想法",
    "发想法",
    "继续",
    "Continue",
    "下一步",
    "上传图文",
    "发布图文",
    "照片/视频",
    "上传图片",
    "上传视频",
    "创建",
    "Create",
    "Next",
    "下一步",
    "Add",
    "添加",
    "Publish",
    "Post",
    "发布",
    "發佈",
    "Done",
    "完成",
    "Save",
    "保存",
    "原创",
    "视频",
    "写文章",
    "上传",
    "发表",
    "编辑",
    "封面设置",
    "立即转换",
    "裁切并使用",
    "确认",
    "上传封面",
  ]) {
    const wrapper = doc.createElement("div");
    const inner = doc.createElement("div");
    const span = doc.createElement("span");
    span.className = "title";
    span.textContent = text;
    const button = doc.createElement("button");
    button.textContent = text;
    inner.append(span, button);
    wrapper.append(inner);
    root.append(wrapper);
  }
  const semi = doc.querySelector(".semi-tabs.semi-tabs-top");
  if (semi) {
    const previous = doc.createElement("div");
    previous.innerHTML = "<div>发布图文</div>";
    semi.before(previous);
  }
  for (const button of doc.querySelectorAll('div[role="button"]')) {
    const span = doc.createElement("span");
    span.textContent = "照片/视频";
    button.append(span);
  }
  const editor = doc.createElement("div");
  editor.contentEditable = "true";
  editor.setAttribute("role", "textbox");
  root.append(editor);
  doc.addEventListener("paste", (event) => {
    const target = event.target as HTMLElement;
    const transfer = (event as ClipboardEvent).clipboardData;
    const text = transfer?.getData("text/plain") || transfer?.getData("text/html") || "";
    if (
      target instanceof doc.defaultView!.HTMLInputElement ||
      target instanceof doc.defaultView!.HTMLTextAreaElement
    )
      (target as HTMLInputElement).value = text;
    else target.textContent = text;
    event.preventDefault();
  });
  doc.addEventListener("beforeinput", (event) => {
    const input = event as InputEvent;
    if (input.data && (event.target as HTMLElement).isContentEditable)
      (event.target as HTMLElement).textContent = input.data;
  });
  const dialog = doc.querySelector('div[role="dialog"]');
  if (dialog)
    for (const element of Array.from(root.children))
      if (element !== dialog && !element.contains(dialog)) dialog.append(element);
  for (const section of doc.querySelectorAll("faceplate-form-section,faceplate-textarea-input")) {
    section.insertAdjacentHTML(
      "beforeend",
      '<post-composer-title name="title"><textarea></textarea></post-composer-title><shreddit-composer name="body"><div contenteditable="true"></div></shreddit-composer>',
    );
  }
  for (const box of doc.querySelectorAll("div.WB_editor_box")) {
    const editor = doc.createElement("div");
    editor.className = "ProseMirror";
    editor.contentEditable = "true";
    editor.setAttribute("role", "textbox");
    box.append(editor);
  }
  for (const node of doc.querySelectorAll('div[role="button"][tabindex="0"]')) {
    node.textContent = "Next";
  }
  for (const node of doc.querySelectorAll(
    'div[aria-label="创建帖子"],div[aria-label="Create a post"],div[aria-label="建立貼文"]',
  )) {
    const span = doc.createElement("span");
    span.textContent = "照片/视频";
    node.append(span);
  }
  for (const title of doc.querySelectorAll("post-composer-title,faceplate-textarea-input")) {
    const shadow = title.attachShadow({ mode: "open" });
    const input = doc.createElement("textarea");
    input.id = "innerTextArea";
    shadow.append(input);
  }
  for (const editor of doc.querySelectorAll('[data-lexical-editor="true"]'))
    editor.setAttribute("aria-placeholder", "What's on your mind? Write a caption");
  return root;
}
describe("upstream adapter browser fixtures", () => {
  for (const adapter of adapterSources) {
    it(`${adapter.id} prepares content without final publication`, async () => {
      const frame = document.createElement("iframe");
      frame.style.width = "1100px";
      frame.style.height = "800px";
      document.body.append(frame);
      frames.push(frame);
      const w = frame.contentWindow! as Window & typeof globalThis;
      const doc = w.document;
      const nativeInputClick = w.HTMLInputElement.prototype.click;
      w.HTMLInputElement.prototype.click = function () {
        if (this.type === "file") this.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
        else nativeInputClick.call(this);
      };
      doc.open();
      doc.write("<!doctype html><html><body></body></html>");
      doc.close();
      (w as unknown as { alert: () => void }).alert = () => {};
      const fixtureLocation = {
        href: adapter.injectUrl,
        origin: new URL(adapter.injectUrl).origin,
        hostname: new URL(adapter.injectUrl).hostname,
        pathname: new URL(adapter.injectUrl).pathname,
        search: "?token=fixture",
        reload: () => {},
      };
      const loadHelper = w.Function("location", `return eval(${JSON.stringify(helperSource)});`);
      loadHelper(fixtureLocation);
      const root = fixtureDocument(
        doc,
        (selectors as Record<string, string[]>)[adapter.sourcePath] ?? [],
        (labels as Record<string, string[]>)[adapter.sourcePath] ?? [],
      );
      // Platform-specific nested controls that cannot be inferred from selectors alone.
      for (const editor of doc.querySelectorAll('div[contenteditable="true"]')) {
        if (!editor.querySelector("p")) editor.append(doc.createElement("p"));
      }
      for (const title of doc.querySelectorAll("#title-textarea"))
        title.innerHTML = '<div id="textbox" contenteditable="true"></div>';
      for (const description of doc.querySelectorAll("#description-textarea"))
        description.innerHTML = '<div id="textbox" contenteditable="true"></div>';
      if (adapter.id === "ARTICLE_AUTOHOME") {
        // oxlint-disable-next-line react/iframe-missing-sandbox -- Sandbox is applied before this fixture frame enters the document.
        const coverFrame = doc.createElement("iframe");
        coverFrame.name = "mofangIframe";
        coverFrame.setAttribute("sandbox", "allow-same-origin");
        doc.body.append(coverFrame);
      }
      if (adapter.id === "ARTICLE_WEIBO") {
        for (const box of doc.querySelectorAll("div.WB_editor_box")) {
          if (!box.querySelector("div.article-cover-add"))
            box.insertAdjacentHTML("beforeend", '<div class="article-cover-add"></div>');
        }
        const upload = doc.createElement("div");
        upload.setAttribute("role", "dialog");
        upload.innerHTML =
          '<div class="byte-tabs-header-title">上传图片</div><input type="file" accept="image/*"><button data-e2e="imageUploadConfirm-btn">Confirm</button>';
        doc.body.append(upload);
      }
      if (adapter.id === "VIDEO_KUAISHOU") {
        doc
          .querySelector("div.ant-modal-body")
          ?.insertAdjacentHTML("beforeend", "<div>上传封面</div>");
        const setting = [...doc.querySelectorAll("span")].find(
          (node) => node.textContent === "封面设置",
        );
        setting?.parentElement?.insertAdjacentHTML(
          "afterend",
          "<div><div><button>Choose cover</button></div></div>",
        );
      }
      const nativeTimer = w.setTimeout.bind(w);
      w.postMessage = ((data: unknown) => {
        const message = data as { type?: string; requestId?: string; files?: File[] };
        if (adapter.id === "VIDEO_WEIBO" && message.type === "WEIBO_UPLOAD_VIDEO") {
          // The fixture supplies the host page's native file-chooser bridge. The
          // publisher must send its real File and correlate the response id.
          const input = doc.querySelector('input[type="file"]') as HTMLInputElement;
          const transfer = new w.DataTransfer();
          for (const file of message.files ?? []) transfer.items.add(file);
          input.files = transfer.files;
          input.dispatchEvent(new w.Event("change", { bubbles: true }));
          nativeTimer(
            () =>
              w.dispatchEvent(
                new w.MessageEvent("message", {
                  data: {
                    type: "WEIBO_UPLOAD_VIDEO_RESULT",
                    requestId: message.requestId,
                    success: transfer.files.length === 1,
                  },
                  source: w,
                }),
              ),
            0,
          );
          return;
        }
        nativeTimer(
          () =>
            w.dispatchEvent(
              new w.MessageEvent("message", { data, source: w, origin: fixtureLocation.origin }),
            ),
          0,
        );
      }) as typeof w.postMessage;
      w.setTimeout = ((callback: TimerHandler, _delay?: number, ...args: unknown[]) =>
        nativeTimer(callback, (_delay ?? 0) >= 5000 ? 30 : 1, ...args)) as typeof w.setTimeout;
      const nativeInterval = w.setInterval.bind(w);
      w.setInterval = ((callback: TimerHandler, _delay?: number, ...args: unknown[]) =>
        nativeInterval(callback, 1, ...args)) as typeof w.setInterval;
      const errors: string[] = [];
      w.console = {
        ...w.console,
        error: (...args: unknown[]) => errors.push(args.map(String).join(" ")),
        debug: (...args: unknown[]) => {
          if (
            /未找到|失败|出错|错误|TypeError|ReferenceError|not found/i.test(
              args.map(String).join(" "),
            )
          )
            errors.push(args.map(String).join(" "));
        },
        log: () => {},
      };
      const nativeFetch = w.fetch.bind(w);
      const canvas = doc.createElement("canvas");
      canvas.width = 2;
      canvas.height = 2;
      canvas.getContext("2d")!.fillRect(0, 0, 2, 2);
      const imageData = canvas.toDataURL("image/png");
      const imageSource = Object.getOwnPropertyDescriptor(w.HTMLImageElement.prototype, "src")!;
      Object.defineProperty(w.HTMLImageElement.prototype, "src", {
        ...imageSource,
        set(this: HTMLImageElement, value: string) {
          imageSource.set!.call(
            this,
            value.startsWith("https://fixture.invalid/") ? imageData : value,
          );
        },
      });
      const writes: string[] = [];
      const responses: string[] = [];
      w.fetch = async (input, init) => {
        const url = String(input);
        responses.push(url);
        if (init?.body) {
          if (init.body instanceof w.FormData)
            writes.push(
              [...init.body.entries()].map(([key, value]) => key + "=" + String(value)).join(" "),
            );
          else writes.push(decodeURIComponent(String(init.body)).replaceAll("+", " "));
        }
        if (url.startsWith("data:")) return nativeFetch(url);
        if (url === "https://mp.weixin.qq.com/")
          return new w.Response(
            'window.wx.commonData = {t:"123456",nick_name:"tester",ticket:"fixture",user_name:"tester"};',
          );
        const body = url.includes("/author/notebooks")
          ? [{ id: 123, name: "Fixture" }]
          : {
              id: 123,
              appMsgId: "fixture-draft-123",
              errno: 0,
              code: url.includes("saveArticle") ? 200 : 0,
              result: [
                { cdnurl: "https://fixture.invalid/image.png", file_id: 123, height: 2, width: 2 },
              ],
              ret: { https_url: "https://fixture.invalid/image.png" },
              success: true,
              wp_autosave: { success: true },
              url: "https://fixture.invalid/image.png",
              data: {
                https_src: "https://fixture.invalid/image.png",
                id: 123,
                aid: 123,
                article_id: "fixture-article-123",
                image_url: "https://fixture.invalid/image.png",
                url: "https://fixture.invalid/image.png",
                key: "fixture",
                token: "fixture",
                dir: "fixture/",
                host: "https://fixture.invalid/",
              },
              content: "123",
              cdn_url: "https://fixture.invalid/image.png",
              base_resp: { err_msg: "ok", ret: 0 },
            };
        return new w.Response(JSON.stringify(body), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      };
      if (adapter.id === "VIDEO_BAIJIAHAO") {
        const completion = doc.createElement("span");
        completion.textContent = "上传完成";
        doc.body.append(completion);
      }
      let submitted = 0;
      doc.addEventListener("click", (event) => {
        if (/^(Post|Publish|发布|發佈)$/.test((event.target as HTMLElement).textContent ?? ""))
          submitted++;
      });
      for (const element of doc.querySelectorAll("iframe")) {
        const body = element.contentDocument?.body;
        if (body) {
          body.contentEditable = "true";
          if (element.name === "mofangIframe")
            body.innerHTML = '<input type="file" accept="image/*"><span>完成制作</span>';
        }
      }
      const postId = doc.querySelector("#post_ID") as HTMLInputElement | null;
      if (postId) postId.value = "123";
      for (const element of doc.querySelectorAll(".CodeMirror"))
        (element as unknown as { CodeMirror: { setValue: (value: string) => void } }).CodeMirror = {
          setValue: (value) => {
            element.textContent = value;
          },
        };
      class FixtureXHR extends w.EventTarget {
        readyState = 0;
        status = 200;
        responseText =
          '{"success":true,"data":{"id":123,"url":"https://fixture.invalid/video.mp4"}}';
        response = this.responseText;
        upload = new w.EventTarget();
        onload: ((event: Event) => void) | null = null;
        onreadystatechange: (() => void) | null = null;
        method = "";
        open(method: string, _url: string) {
          this.method = method;
          this.readyState = 1;
        }
        setRequestHeader() {}
        getAllResponseHeaders() {
          return "content-type: application/json";
        }
        getResponseHeader() {
          return "application/json";
        }
        abort() {}
        send(body?: unknown) {
          if (body) writes.push(String(body));
          nativeTimer(() => {
            this.readyState = 4;
            this.onreadystatechange?.();
            this.upload.dispatchEvent(new w.ProgressEvent("progress", { loaded: 1, total: 1 }));
            this.onload?.(new w.Event("load"));
            this.dispatchEvent(new w.Event("load"));
          }, 1);
        }
      }
      w.XMLHttpRequest = FixtureXHR as unknown as typeof XMLHttpRequest;
      doc.cookie = "bili_jct=fixture; path=/";
      for (const button of doc.querySelectorAll('button[id^="video_button_upload_"]'))
        button.addEventListener("click", () => {
          const input = doc.createElement("input");
          input.type = "file";
          input.accept = "video/mp4";
          doc.body.append(input);
          input.click();
        });
      const sdkEvents = {
        ITEMSELECTED: "selected",
        PROGRESS: "progress",
        SUCCESS: "success",
        ERROR: "error",
        COMPLETED: "completed",
      };
      const browserHandlers = new Map<string, ((...args: unknown[]) => void)[]>();
      const browser = {
        on: (name: string, fn: (...args: unknown[]) => void) => {
          browserHandlers.set(name, [...(browserHandlers.get(name) ?? []), fn]);
        },
        addFileFilter: () => {},
      };
      (w as unknown as { AHVP: unknown }).AHVP = {
        UPLOADER_EVENT: sdkEvents,
        newUploaderManager: class {
          createBrowser() {
            return browser;
          }
          addItem() {}
          start() {
            nativeTimer(() => {
              for (const fn of browserHandlers.get("completed") ?? []) fn({}, { id: 123 });
            }, 2);
          }
        },
      };
      const file = { name: "fixture.png", url: imageData, type: "image/png" };
      const data = {
        title: "Spec fixture title",
        content: "Spec fixture caption",
        description: "Spec fixture description",
        htmlContent: "<p>Spec fixture article</p>",
        markdownContent: "Spec fixture article",
        digest: "Spec fixture excerpt",
        images: [
          "DYNAMIC_DOUYIN",
          "DYNAMIC_REDNOTE",
          "DYNAMIC_INSTAGRAM",
          "DYNAMIC_KUAISHOU",
          "DYNAMIC_SOHUTV",
        ].includes(adapter.id)
          ? [file]
          : [],
        videos: [],
        video: { ...file, name: "fixture.mp4", type: "video/mp4" },
        audio: { ...file, name: "fixture.mp3", type: "audio/mpeg" },
        cover: file,
        tags: [],
      };
      const fakeLocation = {
        ...new URL(adapter.injectUrl),
        href: adapter.injectUrl,
        origin: new URL(adapter.injectUrl).origin,
        hostname: new URL(adapter.injectUrl).hostname,
        host: new URL(adapter.injectUrl).host,
        pathname: new URL(adapter.injectUrl).pathname,
        search: "?token=fixture",
        reload: () => {},
      };
      try {
        const execute = (w as unknown as { Function: FunctionConstructor }).Function(
          "location",
          `return eval(${JSON.stringify(buildPreparationScript(adapter.id, data, { urls: ["https://fixture.invalid/webhook"] }).replaceAll("window.location", "location"))});`,
        );
        await execute(fakeLocation);
      } catch (error) {
        errors.push(String(error));
      }
      const fields =
        [...doc.querySelectorAll("input,textarea,[contenteditable=true]")]
          .map((x) => (x as HTMLInputElement).value ?? x.textContent ?? "")
          .join(" ") +
        [...doc.querySelectorAll("post-composer-title,faceplate-textarea-input")]
          .map(
            (node) =>
              (node.shadowRoot?.querySelector("textarea") as HTMLTextAreaElement | null)?.value ??
              "",
          )
          .join(" ") +
        root.textContent +
        (doc.querySelector("body > article")?.textContent ?? "") +
        [...doc.querySelectorAll("iframe")]
          .map((f) => f.contentDocument?.body?.innerHTML ?? "")
          .join(" ") +
        writes.join(" ");
      const state = (
        w as unknown as {
          __djlMultiPost?: {
            pending: number;
            dispatched: boolean;
            error?: string;
            submit: (authorized: boolean) => Promise<void>;
          };
        }
      ).__djlMultiPost;
      expect(submitted, `${adapter.id} submitted before host consent`).toBe(0);
      if (adapter.id === "ARTICLE_CSDN")
        expect(responses.some((url) => url.includes("saveArticle"))).toBe(false);
      expect(
        fields.includes("Spec fixture") ||
          (adapter.id === "DYNAMIC_WEBHOOK" && state?.pending === 1),
        `${adapter.id}: no fixture content was filled; ${errors.slice(-3).join("; ")}`,
      ).toBe(true);
      expect(state, `${adapter.id}: host gate missing`).toBeDefined();
      expect(state!.error, `${adapter.id}: ${errors.join("; ")}`).toBeNull();
      await expect(state!.submit(false)).rejects.toThrow(/authorization/);
      expect(submitted, `${adapter.id}: denied consent dispatched a publish click`).toBe(0);
      if (state!.pending) {
        const execute = (w as unknown as { Function: FunctionConstructor }).Function(
          `return ${buildSubmissionScript()}`,
        );
        await expect(
          execute(),
          `${adapter.id}: authorized submission failed`,
        ).resolves.toMatchObject({ dispatched: expect.any(Boolean) });
        expect(state!.pending).toBe(0);
        if (adapter.id === "ARTICLE_CSDN")
          expect(responses.some((url) => url.includes("saveArticle"))).toBe(true);
        await expect(state!.submit(true)).rejects.toThrow(/already/);
      } else {
        await expect(state!.submit(true)).rejects.toThrow(/manual/);
      }
    });
  }
});
