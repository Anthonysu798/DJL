import { afterEach, describe, expect, it } from "vitest";
import { annotationBootstrapSource } from "@synara/shared/browserAnnotationBootstrap";

describe("browser annotation iframe fallback DOM isolation", () => {
  afterEach(() => {
    const runtime = (
      globalThis as typeof globalThis & {
        __synaraBrowserAnnotations?: { dispose: () => void };
      }
    ).__synaraBrowserAnnotations;
    runtime?.dispose();
    document.body.replaceChildren();
  });

  it("selects the top-level iframe when a closed-shadow shield receives the pointer", () => {
    const iframe = document.createElement("iframe");
    iframe.dataset.testid = "annotation-frame";
    Object.assign(iframe.style, {
      position: "fixed",
      left: "40px",
      top: "40px",
      width: "160px",
      height: "100px",
    });
    document.body.append(iframe);

    const payloads: unknown[] = [];
    const bindingName = "__annotationIframeBrowserTest";
    Object.assign(globalThis, {
      [bindingName]: (payload: string) => payloads.push(JSON.parse(payload)),
    });
    Function(annotationBootstrapSource(bindingName))();
    const runtime = (
      globalThis as typeof globalThis & {
        __synaraBrowserAnnotations: {
          command: (command: { type: "enable" }) => void;
        };
      }
    ).__synaraBrowserAnnotations;
    runtime.command({ type: "enable" });

    const x = 80;
    const y = 80;
    const hitTarget = document.elementFromPoint(x, y);
    expect(hitTarget?.getAttribute("data-synara-annotation-overlay")).toBe("true");
    hitTarget?.dispatchEvent(
      new PointerEvent("pointerup", {
        bubbles: true,
        composed: true,
        button: 0,
        clientX: x,
        clientY: y,
      }),
    );

    expect(payloads).toMatchObject([
      {
        type: "selected",
        selection: { target: { kind: "element", tagName: "iframe" } },
      },
    ]);
    Reflect.deleteProperty(globalThis, bindingName);
  });

  it("does not recursively observe shield reconciliation inside the overlay shadow root", async () => {
    const pageFrame = document.createElement("iframe");
    document.body.append(pageFrame);

    const overlay = document.createElement("div");
    overlay.dataset.synaraAnnotationOverlay = "true";
    const overlayRoot = overlay.attachShadow({ mode: "closed" });
    const iframeLayer = document.createElement("div");
    overlayRoot.append(iframeLayer);
    document.body.append(overlay);

    let observerCallbacks = 0;
    let reconciliations = 0;
    const reconcile = () => {
      reconciliations += 1;
      iframeLayer.replaceChildren();
      for (const iframe of document.querySelectorAll("iframe")) {
        const shield = document.createElement("div");
        shield.dataset.synaraAnnotationIframeShield = iframe.tagName;
        iframeLayer.append(shield);
      }
    };
    const observer = new MutationObserver(() => {
      observerCallbacks += 1;
      reconcile();
    });
    observer.observe(document.body, { childList: true, subtree: true });

    reconcile();
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(reconciliations).toBe(1);
    expect(observerCallbacks).toBe(0);

    const secondFrame = document.createElement("iframe");
    document.body.insertBefore(secondFrame, overlay);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(observerCallbacks).toBe(1);
    expect(reconciliations).toBe(2);
    expect(iframeLayer.querySelectorAll("[data-synara-annotation-iframe-shield]")).toHaveLength(2);

    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(observerCallbacks).toBe(1);
    expect(reconciliations).toBe(2);
    observer.disconnect();
  });
});
