/** Load the optional graphics after the local splash can paint. */
export function mountStartupBackground(container: HTMLElement, dark: boolean) {
  let destroyed = false;
  let paused = false;
  let background: { pause: (value: boolean) => void; destroy: () => void } | undefined;
  void import("./MicroSlatsBackground").then(
    ({ mountMicroSlatsBackground }) => {
      if (destroyed) return;
      background = mountMicroSlatsBackground(container, dark);
      background.pause(paused);
    },
    () => {
      container.dataset.renderer = "fallback";
    },
  );
  return {
    pause(value: boolean) {
      paused = value;
      background?.pause(value);
    },
    destroy() {
      destroyed = true;
      background?.destroy();
    },
  };
}
