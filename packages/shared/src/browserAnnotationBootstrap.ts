const ANNOTATION_GLOBAL = "__synaraBrowserAnnotations";

export function annotationBootstrapSource(bindingName: string): string {
  return `(() => {
    const KEY = ${JSON.stringify(ANNOTATION_GLOBAL)};
    const OWNER = ${JSON.stringify(bindingName)};
    const binding = globalThis[${JSON.stringify(bindingName)}];
    const existing = globalThis[KEY];
    if (typeof binding !== 'function' || existing?.bindingName === OWNER) return;
    try { existing?.dispose?.(); } catch {}
    const styleKeys = ${JSON.stringify([
      "color",
      "backgroundColor",
      "opacity",
      "fontFamily",
      "fontSize",
      "fontWeight",
      "lineHeight",
      "letterSpacing",
      "textAlign",
      "margin",
      "padding",
      "gap",
      "borderRadius",
    ])};
    let enabled = false;
    let areaMode = false;
    let hovered = null;
    let selected = null;
    let dragStart = null;
    let overlay = null;
    let overlayRoot = null;
    let outline = null;
    let dragBox = null;
    let marker = null;
    let areaSurface = null;
    let iframeLayer = null;
    let iframeObserver = null;
    const iframeShields = new Map();
    let restoration = null;
    const send = value => { try { binding(JSON.stringify(value)); } catch {} };
    const bounded = (value, max) => String(value ?? '').replace(/\\s+/g, ' ').trim().slice(0, max);
    const rectOf = element => {
      const r = element.getBoundingClientRect();
      return { x: r.x, y: r.y, width: Math.max(0, r.width), height: Math.max(0, r.height) };
    };
    const viewport = () => ({ width: innerWidth, height: innerHeight, deviceScaleFactor: devicePixelRatio || 1, scrollX, scrollY });
    const page = () => ({ url: location.href.slice(0, 8192), title: document.title.slice(0, 512) });
    const selector = element => {
      const parts = [];
      let node = element;
      while (node && node.nodeType === 1 && parts.length < 8) {
        let part = node.tagName.toLowerCase();
        if (node.id) { part += '#' + CSS.escape(node.id).slice(0, 256); parts.unshift(part); break; }
        const parent = node.parentElement;
        if (parent) {
          const peers = Array.from(parent.children).filter(child => child.tagName === node.tagName);
          if (peers.length > 1) part += ':nth-of-type(' + (peers.indexOf(node) + 1) + ')';
        }
        parts.unshift(part);
        node = parent;
      }
      return parts.join(' > ').slice(0, 2048);
    };
    const ensureOverlay = () => {
      if (overlay?.isConnected) return;
      const root = document.documentElement || document.body;
      if (!root) return;
      overlay = document.createElement('div');
      overlay.dataset.synaraAnnotationOverlay = 'true';
      Object.assign(overlay.style, { position: 'fixed', inset: '0', zIndex: '2147483647', pointerEvents: 'none' });
      overlayRoot = overlay.attachShadow({ mode: 'closed' });
      outline = document.createElement('div');
      Object.assign(outline.style, { position: 'fixed', border: '2px solid #7c5cff', background: 'rgba(124,92,255,.10)', borderRadius: '3px', display: 'none', pointerEvents: 'none' });
      dragBox = outline.cloneNode();
      marker = document.createElement('div');
      Object.assign(marker.style, { position: 'fixed', width: '24px', height: '24px', borderRadius: '999px', background: '#7c5cff', color: 'white', font: '700 12px/24px system-ui', textAlign: 'center', boxShadow: '0 2px 8px rgba(0,0,0,.35)', display: 'none' });
      areaSurface = document.createElement('div');
      areaSurface.dataset.synaraAnnotationAreaSurface = 'true';
      Object.assign(areaSurface.style, { position: 'fixed', inset: '0', cursor: 'crosshair', background: 'transparent', display: 'none', pointerEvents: 'auto' });
      iframeLayer = document.createElement('div');
      Object.assign(iframeLayer.style, { position: 'fixed', inset: '0', pointerEvents: 'none' });
      overlayRoot.append(areaSurface, iframeLayer, outline, dragBox, marker);
      root.append(overlay);
    };
    const syncInteractionSurfaces = () => {
      ensureOverlay();
      if (areaSurface) areaSurface.style.display = enabled && areaMode && !selected ? 'block' : 'none';
      for (const shield of iframeShields.keys()) shield.remove();
      iframeShields.clear();
      if (!enabled || areaMode || !iframeLayer) return;
      for (const frame of document.querySelectorAll('iframe')) {
        const rect = rectOf(frame);
        if (rect.width <= 0 || rect.height <= 0 || rect.x >= innerWidth || rect.y >= innerHeight || rect.x + rect.width <= 0 || rect.y + rect.height <= 0) continue;
        const shield = document.createElement('div');
        shield.dataset.synaraAnnotationIframeShield = 'true';
        Object.assign(shield.style, { position: 'fixed', left: rect.x + 'px', top: rect.y + 'px', width: rect.width + 'px', height: rect.height + 'px', background: 'transparent', pointerEvents: 'auto', cursor: 'crosshair' });
        iframeShields.set(shield, frame);
        iframeLayer.append(shield);
      }
    };
    const observeIframes = () => {
      if (iframeObserver || typeof MutationObserver !== 'function') return;
      const root = document.documentElement || document.body;
      if (!root) return;
      iframeObserver = new MutationObserver(() => { if (enabled) syncInteractionSurfaces(); });
      iframeObserver.observe(root, { childList: true, subtree: true });
    };
    const stopObservingIframes = () => { iframeObserver?.disconnect(); iframeObserver = null; };
    const place = (node, rect) => Object.assign(node.style, { left: rect.x + 'px', top: rect.y + 'px', width: rect.width + 'px', height: rect.height + 'px', display: 'block' });
    const restore = () => {
      if (restoration) {
        const { element, texts, styles } = restoration;
        try { for (const [node, value] of texts) node.nodeValue = value; for (const [key, value, priority] of styles) value ? element.style.setProperty(key, value, priority) : element.style.removeProperty(key); } catch {}
        restoration = null;
      }
      if (selected?.element?.isConnected) { selected.rect = rectOf(selected.element); if (outline) place(outline, selected.rect); }
      if (marker) marker.style.display = 'none';
    };
    const apply = adjustments => {
      restore();
      if (!selected?.element || selected.kind !== 'element') return;
      const element = selected.element;
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT); const textNodes = []; let textNode; while ((textNode = walker.nextNode())) textNodes.push(textNode);
      restoration = { element, texts: textNodes.map(node => [node, node.nodeValue]), styles: styleKeys.map(key => { const css = key.replace(/[A-Z]/g, m => '-' + m.toLowerCase()); return [css, element.style.getPropertyValue(css), element.style.getPropertyPriority(css)]; }) };
      if (Object.prototype.hasOwnProperty.call(adjustments, 'textContent') && textNodes.length > 0) { textNodes[0].nodeValue = adjustments.textContent; for (const node of textNodes.slice(1)) node.nodeValue = ''; }
      for (const key of styleKeys) if (Object.prototype.hasOwnProperty.call(adjustments, key)) element.style[key] = String(adjustments[key]);
      selected.rect = rectOf(element); if (outline) place(outline, selected.rect);
    };
    const selectElement = element => {
      const rect = rectOf(element);
      selected = { id: crypto.randomUUID(), kind: 'element', element, rect };
      place(outline, rect);
      send({ type: 'selected', selection: { id: selected.id, target: target(), page: page(), viewport: viewport() } });
    };
    const target = () => selected.kind === 'element' ? { kind: 'element', rect: selected.rect, selector: selector(selected.element), tagName: bounded(selected.element.tagName, 64).toLowerCase(), textPreview: bounded(selected.element.textContent, 500), accessibleName: bounded(selected.element.getAttribute('aria-label') || selected.element.getAttribute('alt') || '', 500) } : { kind: 'area', rect: selected.rect };
    const captureMetadata = () => ({ target: target(), page: page(), viewport: viewport() });
    const iframeAtPoint = (x, y) => {
      for (const frame of iframeShields.values()) {
        const rect = rectOf(frame);
        if (x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height) return frame;
      }
      return null;
    };
    const elementFromEvent = event => {
      let originatedFromOverlay = false;
      for (const node of event.composedPath()) {
        const iframe = iframeShields.get(node);
        if (iframe) return iframe;
        if (node === overlay || node instanceof Element && node.closest?.('[data-synara-annotation-overlay]')) { originatedFromOverlay = true; continue; }
        if (!originatedFromOverlay && node instanceof Element) return node;
      }
      return iframeAtPoint(event.clientX, event.clientY);
    };
    const onMove = event => {
      if (!enabled || selected) return;
      if (dragStart) {
        const rect = { x: Math.min(dragStart.x, event.clientX), y: Math.min(dragStart.y, event.clientY), width: Math.abs(event.clientX - dragStart.x), height: Math.abs(event.clientY - dragStart.y) };
        place(dragBox, rect); return;
      }
      if (areaMode) return;
      const element = elementFromEvent(event);
      if (!element || element === hovered) return;
      hovered = element; ensureOverlay(); place(outline, rectOf(element));
    };
    const onDown = event => { if (!enabled || event.button !== 0) return; event.preventDefault(); event.stopImmediatePropagation(); event.stopPropagation(); if (selected || !areaMode) return; dragStart = { x: event.clientX, y: event.clientY }; ensureOverlay(); place(dragBox, { x: event.clientX, y: event.clientY, width: 0, height: 0 }); };
    const onUp = event => {
      if (!enabled || event.button !== 0) return;
      event.preventDefault(); event.stopImmediatePropagation(); event.stopPropagation();
      if (selected) return;
      if (dragStart) {
        const sx = Math.max(0, Math.min(innerWidth, dragStart.x)); const sy = Math.max(0, Math.min(innerHeight, dragStart.y)); const ex = Math.max(0, Math.min(innerWidth, event.clientX)); const ey = Math.max(0, Math.min(innerHeight, event.clientY));
        const rect = { x: Math.min(sx, ex), y: Math.min(sy, ey), width: Math.abs(ex - sx), height: Math.abs(ey - sy) };
        dragStart = null; areaMode = false; selected = { id: crypto.randomUUID(), kind: 'area', rect }; syncInteractionSurfaces(); place(outline, rect); dragBox.style.display = 'none';
        send({ type: 'selected', selection: { id: selected.id, target: { kind: 'area', rect }, page: page(), viewport: viewport() } }); return;
      }
      if (areaMode) return;
      const element = elementFromEvent(event);
      if (!element) return; selectElement(element);
    };
    const cancelAreaForViewportChange = () => { if (selected?.kind !== 'area') return false; selected = null; restore(); if (outline) outline.style.display = 'none'; syncInteractionSurfaces(); send({ type: 'cancelled' }); return true; };
    const onScroll = () => { syncInteractionSurfaces(); if (selected?.element) { selected.rect = rectOf(selected.element); place(outline, selected.rect); } else cancelAreaForViewportChange(); };
    const onResize = () => { syncInteractionSurfaces(); if (selected?.element) { selected.rect = rectOf(selected.element); place(outline, selected.rect); } else cancelAreaForViewportChange(); };
    const onClick = event => { if (!enabled) return; event.preventDefault(); event.stopImmediatePropagation(); event.stopPropagation(); };
    const onDomReady = () => { if (!enabled) return; ensureOverlay(); observeIframes(); syncInteractionSurfaces(); };
    addEventListener('pointermove', onMove, true); addEventListener('pointerdown', onDown, true); addEventListener('pointerup', onUp, true); addEventListener('click', onClick, true); addEventListener('scroll', onScroll, true); addEventListener('resize', onResize, true); addEventListener('DOMContentLoaded', onDomReady, true);
    globalThis[KEY] = {
      bindingName: OWNER,
      command(command) {
        ensureOverlay();
        if (command.type === 'enable') { enabled = true; if (overlay) overlay.style.display = 'block'; observeIframes(); syncInteractionSurfaces(); }
        if (command.type === 'disable') { enabled = false; areaMode = false; selected = null; restore(); stopObservingIframes(); overlay?.remove(); iframeShields.clear(); overlay = overlayRoot = outline = dragBox = marker = areaSurface = iframeLayer = null; }
        if (command.type === 'cancel-selection') { selected = null; dragStart = null; areaMode = false; restore(); if (outline) outline.style.display = 'none'; if (dragBox) dragBox.style.display = 'none'; syncInteractionSurfaces(); send({ type: 'cancelled' }); }
        if (command.type === 'select-area' && !selected) { enabled = true; areaMode = true; ensureOverlay(); observeIframes(); syncInteractionSurfaces(); }
        if (command.type === 'preview' && selected?.id === command.selectionId) apply(command.adjustments || {});
      },
      prepareCapture(input) { if (!selected || selected.id !== input.selectionId) throw new Error('Annotation selection is stale'); apply(input.adjustments || {}); if (selected.element) selected.rect = rectOf(selected.element); ensureOverlay(); if (outline) place(outline, selected.rect); marker.textContent = String(input.markerNumber); marker.style.left = Math.max(4, Math.min(innerWidth - 28, selected.rect.x - 10)) + 'px'; marker.style.top = Math.max(4, Math.min(innerHeight - 28, selected.rect.y - 10)) + 'px'; marker.style.display = 'block'; return captureMetadata(); },
      cleanupCapture() { restore(); },
      dispose() { enabled = false; areaMode = false; dragStart = null; restore(); stopObservingIframes(); removeEventListener('pointermove', onMove, true); removeEventListener('pointerdown', onDown, true); removeEventListener('pointerup', onUp, true); removeEventListener('click', onClick, true); removeEventListener('scroll', onScroll, true); removeEventListener('resize', onResize, true); removeEventListener('DOMContentLoaded', onDomReady, true); overlay?.remove(); iframeShields.clear(); overlay = overlayRoot = outline = dragBox = marker = areaSurface = iframeLayer = null; delete globalThis[KEY]; }
    };
  })()`;
}
