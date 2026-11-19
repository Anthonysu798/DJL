import { createRoot } from "react-dom/client";
import MicroSlats from "./MicroSlats.jsx";

export function mountMicroSlatsBackground(container: HTMLElement, dark: boolean) {
  const root = createRoot(container, {
    // A decorative graphics failure must never prevent the main app from loading.
    onUncaughtError: () => {
      container.dataset.renderer = "fallback";
    },
  });
  function pause(paused: boolean) {
    root.render(
      <MicroSlats
        preset="swell"
        color={dark ? "#9671cc" : "#7c66a6"}
        glintColor={dark ? "#d6e4ff" : "#444b75"}
        backgroundColor={dark ? "#0d0f13" : "#f5f6f8"}
        slatWidth={5}
        slatHeight={19}
        gap={5}
        roundness={0.75}
        speed={0.45}
        interactive={!paused}
        cursorStrength={0.7}
        cursorSize={55}
        swirl={0.3}
        trail={1.4}
        lean={0.12}
        intro
        introDuration={1.2}
        paused={paused}
      />,
    );
  }
  return { pause, destroy: () => queueMicrotask(() => root.unmount()) };
}
