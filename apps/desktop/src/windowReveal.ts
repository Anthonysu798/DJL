export const RENDERER_READY_CHANNEL = "desktop:renderer-ready";

// Electron's first paint can be an empty document. Reveal only after the app
// has also committed its shell, regardless of which notification arrives first.
export function createWindowRevealGate(reveal: () => void) {
  let painted = false;
  let ready = false;
  let finished = false;
  const tryReveal = () => {
    if (finished || !painted || !ready) return;
    finished = true;
    reveal();
  };
  return {
    firstPaint() {
      painted = true;
      tryReveal();
    },
    shellReady() {
      ready = true;
      tryReveal();
    },
    cancel() {
      finished = true;
    },
  };
}
