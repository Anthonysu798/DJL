import { DJL_LOGO_DOT_ROWS } from "../components/settings/remote/djlLogoDots";

/** A small canvas keeps the startup illustration independent of the React app. */
export function mountStartupParticles(canvas: HTMLCanvasElement, dark: boolean) {
  const context = canvas.getContext("2d");
  if (!context) return { pause() {}, reveal() {}, destroy() {} };
  const ctx = context;
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  const events = new AbortController();
  const columns = Math.max(...DJL_LOGO_DOT_ROWS.map((row) => row.length));
  const dots = DJL_LOGO_DOT_ROWS.flatMap((row, y) =>
    [...row].flatMap((value, x) =>
      value === " " ? [] : [{ x, y, light: Number(value) / 9, dx: 0, dy: 0 }],
    ),
  );
  let width = 0;
  let height = 0;
  let frame = 0;
  let started = performance.now();
  let leaving: number | null = null;
  let paused = false;
  let destroyed = false;
  let pointer: { x: number; y: number } | null = null;

  function draw(now: number) {
    if (destroyed || width === 0 || height === 0) return;
    const reduced = motion.matches;
    const elapsed = reduced ? 2 : (now - started) / 1000;
    const formation = Math.min(1, elapsed / 1.25);
    const exit = leaving === null || reduced ? 0 : Math.min(1, (now - leaving) / 280);
    const spacing = Math.min(width / 57, height / 43);
    const centerX = width / 2;
    const centerY = height / 2;
    ctx.clearRect(0, 0, width, height);

    // A faint field gives the forming mark depth without competing with its silhouette.
    for (let i = 0; i < 48; i++) {
      const angle = i * 2.39996 + (reduced ? 0 : elapsed * 0.035);
      const radius = spacing * (21 + (i % 7) * 0.8);
      ctx.beginPath();
      ctx.arc(
        centerX + Math.cos(angle) * radius,
        centerY + Math.sin(angle) * radius * 0.72,
        0.65,
        0,
        Math.PI * 2,
      );
      ctx.fillStyle = dark ? "rgba(159,190,229,.18)" : "rgba(66,95,134,.2)";
      ctx.fill();
    }

    dots.forEach((dot, index) => {
      const seed = Math.sin(index * 127.1 + 311.7) * 43758.5453;
      const random = seed - Math.floor(seed);
      const progress = Math.max(0, Math.min(1, (formation - random * 0.22) / 0.78));
      const settle = 1 - Math.pow(1 - progress, 4);
      const angle = index * 2.39996 + (1 - settle) * 3.8;
      const radius = spacing * (23 + random * 16);
      const targetX = (dot.x - (columns - 1) / 2) * spacing;
      const targetY = (dot.y - (DJL_LOGO_DOT_ROWS.length - 1) / 2) * spacing;
      const wave = reduced ? 0 : Math.sin(dot.x * 0.22 + dot.y * 0.16 - elapsed * 2.2);
      const x = centerX + targetX * settle + Math.cos(angle) * radius * (1 - settle);
      const y = centerY + targetY * settle + Math.sin(angle) * radius * 0.7 * (1 - settle);
      let forceX = 0;
      let forceY = 0;
      if (pointer && !reduced && exit === 0) {
        const distance = Math.hypot(x - pointer.x, y - pointer.y);
        const force = Math.max(0, 1 - distance / 85) * 16;
        forceX = ((x - pointer.x) / Math.max(1, distance)) * force;
        forceY = ((y - pointer.y) / Math.max(1, distance)) * force;
      }
      dot.dx = reduced ? 0 : dot.dx + (forceX - dot.dx) * 0.13;
      dot.dy = reduced ? 0 : dot.dy + (forceY - dot.dy) * 0.13;
      const burst = exit * exit * spacing * (18 + random * 30);
      const px = x + dot.dx + Math.cos(angle) * burst;
      const py = y + dot.dy + wave * 0.65 * settle + Math.sin(angle) * burst;
      const scan = reduced ? 0 : Math.pow(Math.max(0, Math.cos(dot.x * 0.12 - elapsed * 2)), 14);
      const alpha = (0.3 + dot.light * 0.54 + scan * 0.16) * (1 - exit);
      const size = spacing * (0.17 + dot.light * 0.065 + scan * 0.06);
      ctx.beginPath();
      ctx.arc(px, py, size, 0, Math.PI * 2);
      ctx.fillStyle = dark
        ? `rgba(${Math.round(157 + dot.light * 84)},${Math.round(184 + dot.light * 60)},255,${alpha})`
        : `rgba(39,${Math.round(57 + dot.light * 25)},${Math.round(86 + dot.light * 36)},${alpha})`;
      ctx.fill();
      if (scan > 0.7 && !reduced) {
        ctx.beginPath();
        ctx.arc(px, py, size * 2.8, 0, Math.PI * 2);
        ctx.fillStyle = dark
          ? `rgba(134,187,255,${scan * 0.07 * (1 - exit)})`
          : `rgba(65,110,180,${scan * 0.04 * (1 - exit)})`;
        ctx.fill();
      }
    });
    if (!reduced && !paused && !document.hidden) frame = requestAnimationFrame(draw);
  }
  function restart() {
    cancelAnimationFrame(frame);
    draw(performance.now());
  }
  const resize = new ResizeObserver(() => {
    width = canvas.clientWidth;
    height = canvas.clientHeight;
    const ratio = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    restart();
  });
  resize.observe(canvas);
  canvas.addEventListener(
    "pointermove",
    (event) => {
      const bounds = canvas.getBoundingClientRect();
      pointer = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
    },
    { signal: events.signal },
  );
  canvas.addEventListener(
    "pointerleave",
    () => {
      pointer = null;
    },
    { signal: events.signal },
  );
  motion.addEventListener(
    "change",
    () => {
      pointer = null;
      started = performance.now() - 1250;
      restart();
    },
    { signal: events.signal },
  );
  document.addEventListener("visibilitychange", restart, { signal: events.signal });
  return {
    pause(value: boolean) {
      paused = value;
      restart();
    },
    reveal() {
      leaving = performance.now();
      paused = false;
      restart();
    },
    destroy() {
      destroyed = true;
      cancelAnimationFrame(frame);
      resize.disconnect();
      events.abort();
    },
  };
}
