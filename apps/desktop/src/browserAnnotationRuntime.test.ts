import { describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { runInNewContext } from "node:vm";

import {
  clampDragArea,
  decodeBrowserAnnotationBindingPayload,
  previewExistingTextNodes,
  BrowserAnnotationRuntime,
  annotationBootstrapSource,
  withAtomicAnnotationCleanup,
} from "./browserAnnotationRuntime";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe("browser annotation runtime", () => {
  function fakeWebContents(
    options: {
      failPageEnableOnce?: boolean;
      failReplacementEnableOnce?: boolean;
      initiallyAttached?: boolean;
    } = {},
  ) {
    const events = new EventEmitter();
    let attached = options.initiallyAttached ?? false;
    let failed = false;
    const commands: Array<{ method: string; params?: Record<string, unknown> }> = [];
    const debuggerApi = Object.assign(events, {
      isAttached: () => attached,
      attach: () => {
        attached = true;
      },
      detach: vi.fn(() => {
        attached = false;
      }),
      sendCommand: vi.fn(async (method: string, params?: Record<string, unknown>) => {
        commands.push(params ? { method, params } : { method });
        if (options.failPageEnableOnce && method === "Page.enable" && !failed) {
          failed = true;
          throw new Error("init failed");
        }
        if (
          options.failReplacementEnableOnce &&
          method === "Runtime.evaluate" &&
          params?.contextId === 84 &&
          String(params.expression).includes("type: 'enable'") &&
          !failed
        ) {
          failed = true;
          throw new Error("replacement enable failed");
        }
        if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "frame-1" } } };
        if (method === "Page.createIsolatedWorld") return { executionContextId: 42 };
        if (method === "Page.addScriptToEvaluateOnNewDocument") {
          return { identifier: `script-${commands.length}` };
        }
        if (
          method === "Runtime.evaluate" &&
          String(params?.expression).includes("prepareCapture")
        ) {
          return {
            result: {
              value: {
                target: { kind: "area", rect: { x: 10, y: 20, width: 30, height: 40 } },
                page: { url: "https://example.test", title: "Fixture" },
                viewport: {
                  width: 800,
                  height: 600,
                  deviceScaleFactor: 1,
                  scrollX: 0,
                  scrollY: 0,
                },
              },
            },
          };
        }
        return { result: { value: undefined } };
      }),
    });
    return {
      webContents: { debugger: debuggerApi, isDestroyed: () => false } as never,
      debuggerApi,
      commands,
    };
  }

  it("always restores temporary page changes when capture fails", async () => {
    const calls: string[] = [];
    await expect(
      withAtomicAnnotationCleanup(
        async () => void calls.push("prepare"),
        async () => {
          calls.push("capture");
          throw new Error("capture failed");
        },
        async () => void calls.push("cleanup"),
      ),
    ).rejects.toThrow("capture failed");
    expect(calls).toEqual(["prepare", "capture", "cleanup"]);
  });

  it("attempts cleanup when prepare partially mutates then fails", async () => {
    const cleanup = vi.fn(async () => undefined);
    await expect(
      withAtomicAnnotationCleanup(
        async () => {
          throw new Error("prepare failed");
        },
        async () => "never",
        cleanup,
      ),
    ).rejects.toThrow("prepare failed");
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("does not let cleanup failure mask the primary error", async () => {
    await expect(
      withAtomicAnnotationCleanup(
        async () => undefined,
        async () => {
          throw new Error("capture failed");
        },
        async () => {
          throw new Error("cleanup failed");
        },
      ),
    ).rejects.toThrow("capture failed");
  });

  it("drops oversized binding metadata at the trust boundary", () => {
    expect(() =>
      decodeBrowserAnnotationBindingPayload(
        "thread-1" as never,
        "tab-1",
        JSON.stringify({
          type: "selected",
          selection: {
            id: "selection-1",
            target: {
              kind: "element",
              rect: { x: 0, y: 0, width: 10, height: 10 },
              selector: "x".repeat(2_049),
              tagName: "div",
              textPreview: "",
              accessibleName: "",
            },
            page: { url: "https://example.com", title: "Example" },
            viewport: { width: 100, height: 100, deviceScaleFactor: 1, scrollX: 0, scrollY: 0 },
          },
        }),
      ),
    ).toThrow();
  });

  it("runs cleanup exactly once after successful capture", async () => {
    const cleanup = vi.fn(async () => undefined);
    await expect(
      withAtomicAnnotationCleanup(
        async () => undefined,
        async () => "png",
        cleanup,
      ),
    ).resolves.toBe("png");
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("restores exact existing text-node objects and values", () => {
    const first = { nodeValue: "Hello " };
    const nested = { nodeValue: "world" };
    const nodes = [first, nested];
    const restore = previewExistingTextNodes(nodes, "New title");
    expect(nodes).toEqual([{ nodeValue: "New title" }, { nodeValue: "" }]);
    restore();
    expect(nodes[0]).toBe(first);
    expect(nodes[1]).toBe(nested);
    expect(nodes).toEqual([{ nodeValue: "Hello " }, { nodeValue: "world" }]);
  });

  it("clamps reversed drags by both viewport edges", () => {
    expect(
      clampDragArea({ x: 120, y: 90 }, { x: -20, y: 140 }, { width: 100, height: 100 }),
    ).toEqual({
      x: 0,
      y: 90,
      width: 100,
      height: 10,
    });
  });

  it("initializes and evaluates commands only in its isolated world", async () => {
    const fake = fakeWebContents();
    const runtime = new BrowserAnnotationRuntime(
      fake.webContents,
      "thread-1" as never,
      "tab-1",
      vi.fn(),
    );
    await runtime.command({ type: "enable" });
    expect(fake.commands.map((entry) => entry.method)).toEqual(
      expect.arrayContaining([
        "Page.enable",
        "Runtime.enable",
        "Runtime.addBinding",
        "Page.addScriptToEvaluateOnNewDocument",
        "Page.createIsolatedWorld",
        "Runtime.evaluate",
      ]),
    );
    const evaluations = fake.commands.filter((entry) => entry.method === "Runtime.evaluate");
    expect(evaluations.every((entry) => entry.params?.contextId === 42)).toBe(true);
    expect(
      fake.commands.find((entry) => entry.method === "Page.addScriptToEvaluateOnNewDocument")
        ?.params?.worldName,
    ).toBe("synara-browser-annotations");
  });

  it("filters foreign bindings and invalidates selection when its context is destroyed", async () => {
    const fake = fakeWebContents();
    const emit = vi.fn();
    const runtime = new BrowserAnnotationRuntime(
      fake.webContents,
      "thread-1" as never,
      "tab-1",
      emit,
    );
    await runtime.initialize();
    fake.debuggerApi.emit("message", {}, "Runtime.bindingCalled", {
      name: "websiteBinding",
      payload: "{}",
      executionContextId: 42,
    });
    expect(emit).not.toHaveBeenCalled();
    fake.debuggerApi.emit("message", {}, "Runtime.executionContextDestroyed", {
      executionContextId: 42,
    });
    expect(emit).toHaveBeenCalledWith({ type: "cancelled", threadId: "thread-1", tabId: "tab-1" });
    emit.mockClear();
    fake.debuggerApi.emit("message", {}, "Runtime.bindingCalled", {
      name: fake.commands.find((entry) => entry.method === "Runtime.addBinding")?.params?.name,
      payload: JSON.stringify({ type: "cancelled" }),
      executionContextId: 99,
    });
    expect(emit).not.toHaveBeenCalled();
    fake.debuggerApi.emit("message", {}, "Runtime.executionContextCreated", {
      context: { id: 84, name: "synara-browser-annotations", auxData: { frameId: "frame-1" } },
    });
    await runtime.command({ type: "enable" });
    expect(fake.commands.at(-1)?.params?.contextId).toBe(84);
  });

  it("does not adopt a child-frame isolated world", async () => {
    const fake = fakeWebContents();
    const runtime = new BrowserAnnotationRuntime(
      fake.webContents,
      "thread-1" as never,
      "tab-1",
      vi.fn(),
    );
    await runtime.initialize();
    fake.debuggerApi.emit("message", {}, "Runtime.executionContextCreated", {
      context: { id: 99, name: "synara-browser-annotations", auxData: { frameId: "child-frame" } },
    });
    await runtime.command({ type: "enable" });
    expect(fake.commands.at(-1)?.params?.contextId).toBe(42);
  });

  it("reapplies desired enable state when the main-frame context is replaced", async () => {
    const fake = fakeWebContents();
    const runtime = new BrowserAnnotationRuntime(
      fake.webContents,
      "thread-1" as never,
      "tab-1",
      vi.fn(),
    );
    await runtime.command({ type: "enable" });
    const evaluationCount = fake.commands.filter(
      (entry) => entry.method === "Runtime.evaluate",
    ).length;
    fake.debuggerApi.emit("message", {}, "Runtime.executionContextCreated", {
      context: { id: 84, name: "synara-browser-annotations", auxData: { frameId: "frame-1" } },
    });
    await vi.waitFor(() =>
      expect(
        fake.commands.filter((entry) => entry.method === "Runtime.evaluate").length,
      ).toBeGreaterThan(evaluationCount),
    );
    const replacementEvaluation = fake.commands.findLast(
      (entry) => entry.method === "Runtime.evaluate",
    );
    expect(replacementEvaluation?.params?.contextId).toBe(84);
    expect(replacementEvaluation?.params?.expression).toContain("type: 'enable'");
  });

  it("replaces a stale new-document runtime owned by a removed binding", () => {
    const addEventListener = vi.fn();
    const removeEventListener = vi.fn();
    const context = {
      oldBinding: vi.fn(),
      newBinding: vi.fn(),
      addEventListener,
      removeEventListener,
    } as Record<string, unknown>;

    runInNewContext(annotationBootstrapSource("oldBinding"), context);
    const firstRuntime = context.__synaraBrowserAnnotations as { bindingName?: string };
    expect(firstRuntime.bindingName).toBe("oldBinding");
    expect(addEventListener).toHaveBeenCalledTimes(7);

    runInNewContext(annotationBootstrapSource("newBinding"), context);
    const replacementRuntime = context.__synaraBrowserAnnotations as { bindingName?: string };
    expect(replacementRuntime).not.toBe(firstRuntime);
    expect(replacementRuntime.bindingName).toBe("newBinding");
    expect(removeEventListener).toHaveBeenCalledTimes(7);
    expect(addEventListener).toHaveBeenCalledTimes(14);
  });

  it("invalidates its context when Chromium clears all execution contexts", async () => {
    const fake = fakeWebContents();
    const emit = vi.fn();
    const runtime = new BrowserAnnotationRuntime(
      fake.webContents,
      "thread-1" as never,
      "tab-1",
      emit,
    );
    await runtime.initialize();

    fake.debuggerApi.emit("message", {}, "Runtime.executionContextsCleared", {});
    expect(emit).toHaveBeenCalledWith({
      type: "cancelled",
      threadId: "thread-1",
      tabId: "tab-1",
    });
    await runtime.command({ type: "enable" });
    expect(
      fake.commands.filter((entry) => entry.method === "Page.createIsolatedWorld"),
    ).toHaveLength(2);
  });

  it("can enable a replacement context before the document root exists", () => {
    const listeners = new Map<string, EventListener>();
    class FakeElement {
      dataset: Record<string, string> = {};
      style: Record<string, string> = {};
      children: FakeElement[] = [];
      isConnected = false;
      tagName = "DIV";
      id = "";
      nodeType = 1;
      parentElement: FakeElement | null = null;
      shadowRoot: FakeElement | null = null;
      append(...children: FakeElement[]) {
        this.children.push(...children);
        for (const child of children) child.isConnected = true;
      }
      attachShadow() {
        this.shadowRoot = new FakeElement();
        return this.shadowRoot;
      }
      cloneNode() {
        return new FakeElement();
      }
      remove() {
        this.isConnected = false;
      }
      getBoundingClientRect() {
        return { x: 20, y: 30, width: 160, height: 100 };
      }
    }
    let frames: FakeElement[] = [];
    const mutationState: { callback?: () => void } = {};
    class FakeMutationObserver {
      constructor(callback: () => void) {
        mutationState.callback = callback;
      }
      observe = vi.fn();
      disconnect = vi.fn();
    }
    const fakeDocument = {
      documentElement: null as FakeElement | null,
      body: null as FakeElement | null,
      title: "",
      querySelectorAll: () => frames,
      createElement: () => new FakeElement(),
    };
    const context = {
      privateBinding: vi.fn(),
      document: fakeDocument,
      Element: FakeElement,
      MutationObserver: FakeMutationObserver,
      innerWidth: 800,
      innerHeight: 600,
      addEventListener: (type: string, listener: EventListener) => listeners.set(type, listener),
      removeEventListener: vi.fn(),
    } as Record<string, unknown>;
    runInNewContext(annotationBootstrapSource("privateBinding"), context);
    const runtime = context.__synaraBrowserAnnotations as {
      command: (command: { type: "enable" }) => void;
    };
    expect(() => runtime.command({ type: "enable" })).not.toThrow();
    expect(listeners.has("DOMContentLoaded")).toBe(true);
    const root = new FakeElement();
    root.isConnected = true;
    fakeDocument.documentElement = root;
    expect(() => listeners.get("DOMContentLoaded")?.({} as Event)).not.toThrow();
    expect(root.children).toHaveLength(1);
    expect(root.children[0]?.dataset.synaraAnnotationOverlay).toBe("true");
    const iframe = new FakeElement();
    iframe.tagName = "IFRAME";
    frames = [iframe];
    expect(mutationState.callback).toBeTypeOf("function");
    mutationState.callback?.();
    const iframeLayer = root.children[0]?.shadowRoot?.children[1];
    expect(iframeLayer?.children).toHaveLength(1);
    expect(iframeLayer?.children[0]?.dataset.synaraAnnotationIframeShield).toBe("true");
  });

  it("reports a failed replacement-context enable instead of leaving mode stuck", async () => {
    const fake = fakeWebContents({ failReplacementEnableOnce: true });
    const emit = vi.fn();
    const runtime = new BrowserAnnotationRuntime(
      fake.webContents,
      "thread-1" as never,
      "tab-1",
      emit,
      undefined,
      "Couldn't restore browser commenting after the page changed.",
    );
    await runtime.command({ type: "enable" });
    fake.debuggerApi.emit("message", {}, "Runtime.executionContextCreated", {
      context: { id: 84, name: "synara-browser-annotations", auxData: { frameId: "frame-1" } },
    });

    await vi.waitFor(() =>
      expect(emit).toHaveBeenCalledWith({
        type: "runtime-error",
        threadId: "thread-1",
        tabId: "tab-1",
        message: "Couldn't restore browser commenting after the page changed.",
      }),
    );
    fake.debuggerApi.emit("message", {}, "Runtime.executionContextCreated", {
      context: { id: 85, name: "synara-browser-annotations", auxData: { frameId: "frame-1" } },
    });
    await vi.waitFor(() =>
      expect(
        fake.commands.some(
          (entry) =>
            entry.method === "Runtime.evaluate" &&
            entry.params?.contextId === 85 &&
            String(entry.params.expression).includes("type: 'enable'"),
        ),
      ).toBe(true),
    );
  });

  it("runs runtime cleanup after a failed atomic capture", async () => {
    const fake = fakeWebContents();
    const runtime = new BrowserAnnotationRuntime(
      fake.webContents,
      "thread-1" as never,
      "tab-1",
      vi.fn(),
    );
    await expect(
      runtime.capture(
        {
          threadId: "thread-1" as never,
          tabId: "tab-1",
          selectionId: "selection-1",
          markerNumber: 1,
          adjustments: {},
        },
        async () => {
          throw new Error("png failed");
        },
      ),
    ).rejects.toThrow("png failed");
    const expressions = fake.commands
      .filter((entry) => entry.method === "Runtime.evaluate")
      .map((entry) => String(entry.params?.expression));
    expect(expressions.some((value) => value.includes("prepareCapture"))).toBe(true);
    expect(expressions.at(-1)).toContain("cleanupCapture");
  });

  it("returns the final geometry prepared for the annotated screenshot", async () => {
    const fake = fakeWebContents();
    const runtime = new BrowserAnnotationRuntime(
      fake.webContents,
      "thread-1" as never,
      "tab-1",
      vi.fn(),
    );
    const result = await runtime.capture(
      {
        threadId: "thread-1" as never,
        tabId: "tab-1",
        selectionId: "selection-1",
        markerNumber: 1,
        adjustments: {},
      },
      async () => Buffer.from("png"),
    );
    expect(result.metadata.target.rect).toEqual({ x: 10, y: 20, width: 30, height: 40 });
    expect(result.pngBytes).toEqual(Buffer.from("png"));
  });

  it("does not interleave preview commands with atomic screenshot capture", async () => {
    const fake = fakeWebContents();
    const runtime = new BrowserAnnotationRuntime(
      fake.webContents,
      "thread-1" as never,
      "tab-1",
      vi.fn(),
    );
    const capturing = deferred();
    const capture = runtime.capture(
      {
        threadId: "thread-1" as never,
        tabId: "tab-1",
        selectionId: "selection-1",
        markerNumber: 1,
        adjustments: {},
      },
      async () => {
        await capturing.promise;
        return Buffer.from("png");
      },
    );
    await vi.waitFor(() =>
      expect(
        fake.commands.some((entry) => String(entry.params?.expression).includes("prepareCapture")),
      ).toBe(true),
    );
    const preview = runtime.command({
      type: "preview",
      selectionId: "selection-1",
      adjustments: { color: "#112233" },
    });
    expect(
      fake.commands.some((entry) => String(entry.params?.expression).includes('"type":"preview"')),
    ).toBe(false);
    capturing.resolve();
    await capture;
    await preview;
    const evaluations = fake.commands
      .filter((entry) => entry.method === "Runtime.evaluate")
      .map((entry) => String(entry.params?.expression));
    expect(evaluations.findIndex((value) => value.includes("cleanupCapture"))).toBeLessThan(
      evaluations.findIndex((value) => value.includes('"type":"preview"')),
    );
  });

  it("allows a fresh runtime to retry after initialization failure", async () => {
    const fake = fakeWebContents({ failPageEnableOnce: true });
    const first = new BrowserAnnotationRuntime(
      fake.webContents,
      "thread-1" as never,
      "tab-1",
      vi.fn(),
    );
    await expect(first.initialize()).rejects.toThrow("init failed");
    await first.dispose();
    const retry = new BrowserAnnotationRuntime(
      fake.webContents,
      "thread-1" as never,
      "tab-1",
      vi.fn(),
    );
    await expect(retry.initialize()).resolves.toBeUndefined();
  });

  it("removes page listeners, script registration, and binding before re-enable", async () => {
    const fake = fakeWebContents();
    const first = new BrowserAnnotationRuntime(
      fake.webContents,
      "thread-1" as never,
      "tab-1",
      vi.fn(),
    );
    await first.initialize();
    await first.dispose();
    await first.dispose();
    const removalMethods = fake.commands
      .map((entry) => entry.method)
      .filter((method) => method.startsWith("Page.remove") || method === "Runtime.removeBinding");
    expect(removalMethods).toEqual([
      "Page.removeScriptToEvaluateOnNewDocument",
      "Runtime.removeBinding",
    ]);
    expect(
      fake.commands.find((entry) => entry.method === "Runtime.evaluate")?.params?.expression,
    ).toContain("dispose()");

    const emit = vi.fn();
    const second = new BrowserAnnotationRuntime(
      fake.webContents,
      "thread-1" as never,
      "tab-1",
      emit,
    );
    await second.initialize();
    const bindings = fake.commands.filter((entry) => entry.method === "Runtime.addBinding");
    expect(bindings).toHaveLength(2);
    fake.debuggerApi.emit("message", {}, "Runtime.bindingCalled", {
      name: bindings[1]?.params?.name,
      payload: JSON.stringify({ type: "cancelled" }),
      executionContextId: 42,
    });
    expect(emit).toHaveBeenCalledWith({ type: "cancelled", threadId: "thread-1", tabId: "tab-1" });
  });

  it("detaches a debugger attachment it owns after annotation cleanup", async () => {
    const fake = fakeWebContents();
    const runtime = new BrowserAnnotationRuntime(
      fake.webContents,
      "thread-1" as never,
      "tab-1",
      vi.fn(),
    );
    await runtime.initialize();
    await runtime.dispose();
    expect(fake.debuggerApi.detach).toHaveBeenCalledOnce();
  });

  it("preserves a debugger that was attached before annotations initialized", async () => {
    const fake = fakeWebContents({ initiallyAttached: true });
    const runtime = new BrowserAnnotationRuntime(
      fake.webContents,
      "thread-1" as never,
      "tab-1",
      vi.fn(),
    );
    await runtime.initialize();
    await runtime.dispose();
    expect(fake.debuggerApi.detach).not.toHaveBeenCalled();
    expect(fake.debuggerApi.isAttached()).toBe(true);
  });

  it("preserves its owned debugger while browser-use holds a shared CDP lease", async () => {
    const fake = fakeWebContents();
    const runtime = new BrowserAnnotationRuntime(
      fake.webContents,
      "thread-1" as never,
      "tab-1",
      vi.fn(),
      () => false,
    );
    await runtime.initialize();
    await runtime.dispose();
    expect(fake.debuggerApi.detach).not.toHaveBeenCalled();
    expect(fake.debuggerApi.isAttached()).toBe(true);
  });

  it("blocks page clicks only while enabled and tracks preview geometry", () => {
    const source = annotationBootstrapSource("privateBinding");
    expect(source).toContain("if (!enabled || event.button !== 0) return");
    expect(source).toContain(
      "event.preventDefault(); event.stopImmediatePropagation(); event.stopPropagation()",
    );
    expect(source).toContain("event.stopImmediatePropagation()");
    expect(source).toContain("addEventListener('click', onClick, true)");
    expect(source).toContain("removeEventListener('click', onClick, true)");
    expect(source).toContain(
      "selected.rect = rectOf(element); if (outline) place(outline, selected.rect)",
    );
    expect(source).toContain("if (selected.element) selected.rect = rectOf(selected.element)");
    expect(source).toContain("Math.min(innerWidth - 28, selected.rect.x - 10)");
    expect(source).toContain("Math.min(innerHeight - 28, selected.rect.y - 10)");
  });

  it("locks selection while the renderer editor owns an unsaved finding", () => {
    const source = annotationBootstrapSource("privateBinding");
    expect(source).toContain("if (!enabled || selected) return");
    expect(source).toContain("if (selected || !areaMode) return");
    expect(source).toContain("if (selected) return");
    expect(source).toContain("if (command.type === 'select-area' && !selected)");
  });

  it("captures area drags above iframe contents and falls element selection back to iframe", () => {
    const source = annotationBootstrapSource("privateBinding");
    expect(source).toContain("areaSurface.dataset.synaraAnnotationAreaSurface = 'true'");
    expect(source).toContain("areaSurface.style.display = enabled && areaMode && !selected");
    expect(source).toContain("for (const frame of document.querySelectorAll('iframe'))");
    expect(source).toContain("iframeShields.set(shield, frame)");
    expect(source).toContain("const iframe = iframeShields.get(node)");
    expect(source).toContain("if (iframe) return iframe");
    expect(source).toContain("return iframeAtPoint(event.clientX, event.clientY)");
    expect(source).toContain("iframeShields.clear()");
  });

  it("refreshes element geometry and invalidates fixed area geometry on viewport resize", () => {
    const source = annotationBootstrapSource("privateBinding");
    expect(source).toContain("const onResize = () =>");
    expect(source).toContain("selected.rect = rectOf(selected.element)");
    expect(source).toContain("cancelAreaForViewportChange()");
    expect(source).toContain("addEventListener('resize', onResize, true)");
    expect(source).toContain("removeEventListener('resize', onResize, true)");
  });
});
