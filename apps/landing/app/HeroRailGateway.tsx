"use client";

import { useEffect, useRef, type CSSProperties } from "react";
import * as THREE from "three";
import { createTaskCore } from "./ContextRailPbrScene";
import "./hero-rail-gateway.css";

type GatewayStat = {
  k: string;
  v: string;
};

type GatewayAutoState =
  | "hero-ready"
  | "playing-forward"
  | "playing-reverse"
  | "settling-forward"
  | "settling-reverse"
  | "rail-ready";

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const smoothRange = (from: number, to: number, value: number) => {
  const t = clamp01((value - from) / Math.max(0.0001, to - from));
  return t * t * (3 - 2 * t);
};

// One continuous C2 curve keeps velocity and acceleration continuous through
// the whole match cut. The visual beats still come from the scroll-progress
// ranges below, without the stop/start sensation of stitched easings.
const smootherStep = (value: number) => {
  const t = clamp01(value);
  return t * t * t * (t * (t * 6 - 15) + 10);
};

function disposeScene(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();

  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Points)) {
      return;
    }
    geometries.add(object.geometry);
    const source = Array.isArray(object.material) ? object.material : [object.material];
    source.forEach((material) => {
      materials.add(material);
      Object.values(material).forEach((value) => {
        if (value instanceof THREE.Texture) textures.add(value);
      });
    });
  });

  textures.forEach((texture) => texture.dispose());
  materials.forEach((material) => material.dispose());
  geometries.forEach((geometry) => geometry.dispose());
}

export function HeroRailGateway({ stats }: { stats: readonly GatewayStat[] }) {
  const rootRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const desktopPointer = window.matchMedia("(hover: hover) and (pointer: fine)");
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const triggerThreshold = 16;
    const gestureIdle = 120;
    const railGestureIdle = 360;
    const settleIdle = 300;
    const settleMax = 520;
    let state: GatewayAutoState = "hero-ready";
    let frame = 0;
    let scrollFrame = 0;
    let releaseTimer = 0;
    let gestureTimer = 0;
    let accumulated = 0;
    let gestureDirection = 0;
    let railGestureDirection = 0;
    let railGestureLastAt = 0;
    let lastWheelAt = 0;
    let activeDirection: -1 | 0 | 1 = 0;
    let activeTarget = 0;
    let lastObservedY = window.scrollY;
    let navigationBypassUntil = 0;

    const railElement = () => document.querySelector<HTMLElement>(".context-rail-field");
    const railTop = () => {
      const rail = railElement();
      if (!rail) return 0;
      return window.scrollY + rail.getBoundingClientRect().top;
    };

    const introReady = () => (
      Boolean((window as unknown as { __djlIntroDone?: boolean }).__djlIntroDone)
      || document.querySelector(".site-nav")?.getAttribute("data-revealed") === "true"
      || window.location.hash === "#start"
      || window.location.hash.startsWith("#capability-")
    );

    const setState = (next: GatewayAutoState) => {
      state = next;
      root.dataset.autoTransition = next;
      document.documentElement.dataset.djlGatewayState = next;
      root.setAttribute(
        "aria-busy",
        next.startsWith("playing") || next.startsWith("settling") ? "true" : "false",
      );
      window.dispatchEvent(new CustomEvent("djl:gateway-state", {
        detail: { state: next },
      }));
    };

    const clearGesture = () => {
      window.clearTimeout(gestureTimer);
      gestureTimer = 0;
      accumulated = 0;
      gestureDirection = 0;
    };

    const releaseWhenQuiet = (direction: -1 | 1, settleStartedAt: number) => {
      window.clearTimeout(releaseTimer);
      const now = performance.now();
      const quietFor = now - lastWheelAt;
      if (quietFor < settleIdle && now - settleStartedAt < settleMax) {
        releaseTimer = window.setTimeout(
          () => releaseWhenQuiet(direction, settleStartedAt),
          Math.min(settleIdle - quietFor + 8, settleMax - (now - settleStartedAt)),
        );
        return;
      }
      activeDirection = 0;
      setState(direction > 0 ? "rail-ready" : "hero-ready");
    };

    const finishAt = (direction: -1 | 1, target: number) => {
      if (frame) {
        window.cancelAnimationFrame(frame);
        frame = 0;
      }
      window.scrollTo({ top: target, left: 0, behavior: "auto" });

      if (direction > 0) {
        window.history.replaceState(
          window.history.state,
          "",
          `${window.location.pathname}${window.location.search}#capability-local`,
        );
      } else if (window.location.hash.startsWith("#capability-")) {
        window.history.replaceState(
          window.history.state,
          "",
          `${window.location.pathname}${window.location.search}`,
        );
      }

      lastWheelAt = performance.now();
      setState(direction > 0 ? "settling-forward" : "settling-reverse");
      releaseWhenQuiet(direction, lastWheelAt);
    };

    const play = (direction: -1 | 1) => {
      const destination = direction > 0 ? railTop() : 0;
      if (destination <= 0 && direction > 0) return;

      clearGesture();
      window.clearTimeout(releaseTimer);
      activeDirection = direction;
      activeTarget = destination;
      setState(direction > 0 ? "playing-forward" : "playing-reverse");

      if (reduceMotion.matches) {
        finishAt(direction, destination);
        return;
      }

      const start = performance.now();
      const startY = window.scrollY;
      const distance = Math.abs(destination - startY);
      const total = Math.max(1, railTop());
      const span = clamp01(distance / total);
      const duration = Math.max(
        direction > 0 ? 760 : 640,
        (direction > 0 ? 1760 : 1440) * span,
      );

      const tick = (now: number) => {
        const elapsed = clamp01((now - start) / duration);
        const timeline = smootherStep(elapsed);
        const next = startY + (activeTarget - startY) * timeline;
        window.scrollTo(0, next);

        if (elapsed < 1) {
          frame = window.requestAnimationFrame(tick);
          return;
        }
        finishAt(direction, activeTarget);
      };

      frame = window.requestAnimationFrame(tick);
    };

    const normalizedDelta = (event: WheelEvent) => {
      const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? 16
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
          ? window.innerHeight
          : 1;
      return event.deltaY * unit;
    };

    const absorb = (event: WheelEvent) => {
      event.preventDefault();
      event.stopImmediatePropagation();
    };

    const onWheel = (event: WheelEvent) => {
      if (
        event.defaultPrevented
        || !desktopPointer.matches
        || !introReady()
        || event.ctrlKey
        || event.metaKey
        || event.buttons !== 0
        || Math.abs(event.deltaY) <= Math.abs(event.deltaX) * 1.25
      ) {
        return;
      }

      const delta = normalizedDelta(event);
      if (Math.abs(delta) < 0.1) return;
      const direction = Math.sign(delta);
      const targetTop = railTop();
      const now = performance.now();
      const isPlaying = state.startsWith("playing") || state.startsWith("settling");

      if (isPlaying) {
        lastWheelAt = now;
        absorb(event);
        return;
      }

      if (window.scrollY > targetTop + 4) {
        railGestureDirection = direction;
        railGestureLastAt = now;
        clearGesture();
        return;
      }

      const forwardZone = direction > 0 && window.scrollY < targetTop - 2;
      const reverseZone = direction < 0 && window.scrollY > 2 && window.scrollY <= targetTop + 4;
      const isRailTail = (
        reverseZone
        && railGestureDirection === direction
        && now - railGestureLastAt < railGestureIdle
      );
      if (isRailTail) {
        railGestureLastAt = now;
        absorb(event);
        return;
      }
      if (now - railGestureLastAt >= railGestureIdle) {
        railGestureDirection = 0;
      }

      if (!forwardZone && !reverseZone) {
        clearGesture();
        return;
      }

      absorb(event);
      if (gestureDirection !== direction) {
        accumulated = 0;
        gestureDirection = direction;
      }
      accumulated += delta;
      window.clearTimeout(gestureTimer);
      gestureTimer = window.setTimeout(clearGesture, gestureIdle);

      if (Math.abs(accumulated) < triggerThreshold) return;
      lastWheelAt = now;
      play(direction > 0 ? 1 : -1);
    };

    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (!introReady()) return;
      const target = event.target as HTMLElement | null;
      if (
        target?.isContentEditable
        || target?.matches("input, textarea, select")
      ) {
        return;
      }

      if (event.key === "Escape" && activeDirection !== 0) {
        event.preventDefault();
        event.stopImmediatePropagation();
        finishAt(activeDirection, activeTarget);
        return;
      }

      if (state.startsWith("playing") || state.startsWith("settling")) {
        if (["ArrowDown", "ArrowUp", "PageDown", "PageUp", " ", "Spacebar"].includes(event.key)) {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
        return;
      }

      const targetTop = railTop();
      const forwardKey = ["ArrowDown", "PageDown", " ", "Spacebar"].includes(event.key)
        && !event.shiftKey;
      const reverseKey = ["ArrowUp", "PageUp"].includes(event.key)
        || ((event.key === " " || event.key === "Spacebar") && event.shiftKey);

      if (forwardKey && window.scrollY < targetTop - 2) {
        event.preventDefault();
        event.stopImmediatePropagation();
        play(1);
      } else if (reverseKey && window.scrollY > 2 && window.scrollY <= targetTop + 4) {
        event.preventDefault();
        event.stopImmediatePropagation();
        play(-1);
      }
    };

    const cancelForNavigation = () => {
      navigationBypassUntil = performance.now() + 1600;
      if (frame) {
        window.cancelAnimationFrame(frame);
        frame = 0;
      }
      window.clearTimeout(releaseTimer);
      clearGesture();
      activeDirection = 0;
      setState(window.scrollY >= railTop() - 2 ? "rail-ready" : "hero-ready");
    };

    const onNavigationPointer = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (target?.closest(".site-nav a")) cancelForNavigation();
    };

    const onScroll = () => {
      if (scrollFrame) return;
      scrollFrame = window.requestAnimationFrame(() => {
        scrollFrame = 0;
        const currentY = window.scrollY;
        const previousY = lastObservedY;
        lastObservedY = currentY;
        const delta = currentY - previousY;
        if (
          Math.abs(delta) < 1
          || !desktopPointer.matches
          || !introReady()
          || state.startsWith("playing")
          || state.startsWith("settling")
          || performance.now() < navigationBypassUntil
        ) {
          return;
        }

        const targetTop = railTop();
        if (
          delta > 0
          && previousY < targetTop - 2
          && !window.location.hash.startsWith("#capability-")
        ) {
          window.scrollTo({
            top: Math.max(0, Math.min(previousY, targetTop - 4)),
            left: 0,
            behavior: "auto",
          });
          lastObservedY = window.scrollY;
          lastWheelAt = performance.now();
          play(1);
          return;
        }

        const railTailActive = (
          railGestureDirection < 0
          && performance.now() - railGestureLastAt < railGestureIdle
        );
        if (
          delta < 0
          && currentY > 2
          && currentY < targetTop - 2
          && previousY <= targetTop + 4
          && !railTailActive
        ) {
          lastWheelAt = performance.now();
          play(-1);
        }
      });
    };

    setState(window.scrollY >= railTop() - 2 ? "rail-ready" : "hero-ready");
    window.addEventListener("wheel", onWheel, { passive: false, capture: true });
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("pointerdown", onNavigationPointer, true);
    window.addEventListener("djl:select-capability", cancelForNavigation);
    window.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      if (scrollFrame) window.cancelAnimationFrame(scrollFrame);
      window.clearTimeout(releaseTimer);
      window.clearTimeout(gestureTimer);
      window.removeEventListener("wheel", onWheel, true);
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("pointerdown", onNavigationPointer, true);
      window.removeEventListener("djl:select-capability", cancelForNavigation);
      window.removeEventListener("scroll", onScroll);
      delete root.dataset.autoTransition;
      delete document.documentElement.dataset.djlGatewayState;
    };
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    if (!root || !canvas) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    root.dataset.reduced = reduceMotion ? "true" : "false";
    if (reduceMotion) return;

    const renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      powerPreference: "high-performance",
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.16;
    renderer.setClearColor(0x000000, 0);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 50);
    camera.position.set(0, 0.05, 7.4);
    camera.lookAt(0, 0, 0);

    scene.add(new THREE.HemisphereLight(0xffffff, 0xb7c8e8, 2.7));
    const keyLight = new THREE.DirectionalLight(0xffffff, 4.2);
    keyLight.position.set(-3.5, 5.5, 7);
    scene.add(keyLight);
    const blueLight = new THREE.PointLight(0x1677ff, 26, 10, 1.8);
    blueLight.position.set(1.4, -0.4, 3.2);
    scene.add(blueLight);

    const task = createTaskCore();
    task.group.scale.setScalar(0.01);
    scene.add(task.group);

    const energyGroup = new THREE.Group();
    const energyLines: Array<{
      geometry: THREE.BufferGeometry;
      material: THREE.LineBasicMaterial;
      points: number;
    }> = [];
    const energyPalette = [0x8ec7ff, 0x3d91ff, 0x176df5, 0x83bfff, 0x2e83ff, 0xc5e3ff];

    for (let index = 0; index < 6; index += 1) {
      const angle = (index / 6) * Math.PI * 2 - Math.PI / 2;
      const outer = new THREE.Vector3(
        Math.cos(angle) * (4.1 + (index % 2) * 0.35),
        Math.sin(angle) * (2.25 + ((index + 1) % 2) * 0.2),
        -0.8 - (index % 3) * 0.18,
      );
      const bend = new THREE.Vector3(
        Math.cos(angle + 0.42) * 2.15,
        Math.sin(angle + 0.42) * 1.12,
        -0.15,
      );
      const curve = new THREE.CatmullRomCurve3([
        outer,
        outer.clone().lerp(bend, 0.45),
        bend,
        new THREE.Vector3(
          Math.cos(angle - 0.3) * 0.62,
          Math.sin(angle - 0.3) * 0.36,
          0.16,
        ),
        new THREE.Vector3(0, 0, 0.32),
      ]);
      const curvePoints = curve.getPoints(96);
      const geometry = new THREE.BufferGeometry().setFromPoints(curvePoints);
      geometry.setDrawRange(0, 0);
      const material = new THREE.LineBasicMaterial({
        color: energyPalette[index],
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      });
      const line = new THREE.Line(geometry, material);
      line.frustumCulled = false;
      energyGroup.add(line);
      energyLines.push({ geometry, material, points: curvePoints.length });
    }
    scene.add(energyGroup);

    const shockwaves: Array<{
      mesh: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>;
      offset: number;
    }> = [];
    for (let index = 0; index < 3; index += 1) {
      const material = new THREE.MeshBasicMaterial({
        color: index === 0 ? 0xd8ebff : 0x247bff,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      });
      const mesh = new THREE.Mesh(
        new THREE.TorusGeometry(0.82, 0.012 + index * 0.004, 8, 96),
        material,
      );
      mesh.position.z = -0.22 - index * 0.08;
      scene.add(mesh);
      shockwaves.push({ mesh, offset: index * 0.085 });
    }

    const streakCount = window.innerWidth < 720 ? 72 : 132;
    const streakPositions = new Float32Array(streakCount * 2 * 3);
    const streakSeeds = Array.from({ length: streakCount }, (_, index) => ({
      angle: ((index * 137.508) % 360) * (Math.PI / 180),
      phase: ((index * 47) % streakCount) / streakCount,
      speed: 0.72 + ((index * 29) % 41) / 70,
      depth: ((index * 17) % 23) / 23,
    }));
    const streakGeometry = new THREE.BufferGeometry();
    streakGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(streakPositions, 3),
    );
    const streakMaterial = new THREE.LineBasicMaterial({
      color: 0x5ba2ff,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    const streaks = new THREE.LineSegments(streakGeometry, streakMaterial);
    streaks.frustumCulled = false;
    scene.add(streaks);

    let visible = true;
    let frame = 0;
    let lastTime = performance.now();

    const resize = () => {
      const width = Math.max(1, root.clientWidth);
      const height = Math.max(1, window.innerHeight);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };

    const render = (time: number) => {
      frame = window.requestAnimationFrame(render);
      if (!visible || document.hidden) {
        lastTime = time;
        return;
      }

      const rect = root.getBoundingClientRect();
      const progress = clamp01(
        (window.innerHeight - rect.top)
        / Math.max(1, window.innerHeight + rect.height),
      );
      const entry = smoothRange(0.015, 0.19, progress);
      const gather = smoothRange(0.11, 0.43, progress);
      const approach = smoothRange(0.23, 0.525, progress);
      const emerge = smoothRange(0.53, 0.68, progress);
      const dock = smoothRange(0.64, 0.92, progress);
      const exit = smoothRange(0.79, 0.925, progress);
      const veil = Math.exp(-Math.pow((progress - 0.535) / 0.067, 2));
      const pulse = Math.exp(-Math.pow((progress - 0.69) / 0.072, 2));
      const dt = Math.min(0.05, Math.max(0, (time - lastTime) / 1000));
      lastTime = time;

      root.style.setProperty("--hrg-progress", progress.toFixed(4));
      root.style.setProperty("--hrg-entry", entry.toFixed(4));
      root.style.setProperty("--hrg-gather", gather.toFixed(4));
      root.style.setProperty("--hrg-post", dock.toFixed(4));
      root.style.setProperty("--hrg-exit", exit.toFixed(4));
      root.style.setProperty("--hrg-veil", Math.min(1, veil * 1.18).toFixed(4));
      root.style.setProperty(
        "--hrg-canvas-shift",
        `${Math.min(rect.height, Math.max(0, -rect.top)).toFixed(2)}px`,
      );
      root.style.setProperty(
        "--hrg-canvas-opacity",
        Math.max(0, entry * Math.pow(1 - exit, 2)).toFixed(4),
      );

      let coreScale: number;
      if (progress <= 0.535) {
        const accelerated = Math.pow(approach, 2.15);
        coreScale = THREE.MathUtils.lerp(0.36, 12.8, accelerated);
        task.group.position.set(
          THREE.MathUtils.lerp(0.15, 0, approach),
          THREE.MathUtils.lerp(-1.15, 0, approach),
          THREE.MathUtils.lerp(-0.75, 2.78, accelerated),
        );
      } else {
        coreScale = THREE.MathUtils.lerp(12.8, 0.92, emerge);
        task.group.position.set(
          THREE.MathUtils.lerp(0, -1.87, dock),
          THREE.MathUtils.lerp(0, -1.58, dock),
          THREE.MathUtils.lerp(2.78, 0.2, emerge),
        );
      }
      task.group.scale.setScalar(coreScale);

      const rollDistance = progress * Math.PI * 5.6;
      task.body.rotation.x = rollDistance;
      task.body.rotation.z = rollDistance * 0.72;
      task.body.rotation.y = Math.sin(progress * Math.PI * 2) * 0.32;
      task.halo.rotation.z -= dt * (0.58 + gather * 2.2);
      task.halo.scale.setScalar(0.92 + pulse * 0.75);
      task.haloMaterial.opacity = 0.22 + gather * 0.3 + pulse * 0.14;
      task.light.intensity = 10 + gather * 22 + veil * 34;

      energyGroup.position.copy(task.group.position);
      energyGroup.scale.setScalar(
        progress < 0.535
          ? THREE.MathUtils.lerp(0.72, 1.28, gather)
          : THREE.MathUtils.lerp(1.28, 0.38, emerge),
      );
      energyGroup.rotation.z = progress * -0.86;
      const energyVisible = gather * (1 - smoothRange(0.47, 0.62, progress));
      energyLines.forEach(({ geometry, material, points }, index) => {
        const lineProgress = smoothRange(
          0.1 + index * 0.018,
          0.34 + index * 0.018,
          progress,
        );
        geometry.setDrawRange(0, Math.max(0, Math.floor(points * lineProgress)));
        material.opacity = energyVisible * (0.42 + (index % 3) * 0.1);
      });

      shockwaves.forEach(({ mesh, offset }) => {
        const wave = smoothRange(0.6 + offset, 0.79 + offset, progress);
        mesh.scale.setScalar(0.35 + wave * 4.6);
        mesh.material.opacity = pulse * (1 - wave) * 0.78;
        mesh.rotation.z = -progress * (0.5 + offset * 2);
      });

      const streakAttribute = streakGeometry.getAttribute(
        "position",
      ) as THREE.BufferAttribute;
      const warpStrength = gather * (1 - smoothRange(0.55, 0.79, progress));
      streakSeeds.forEach((seed, index) => {
        const travel = (
          seed.phase
          + progress * seed.speed * 2.7
          + time * 0.000018 * seed.speed
        ) % 1;
        const radius = 0.48 + travel * 5.5;
        const length = 0.05 + warpStrength * (0.18 + travel * 0.34);
        const squash = 0.55 + seed.depth * 0.12;
        const end = index * 6;
        streakPositions[end] = Math.cos(seed.angle) * radius;
        streakPositions[end + 1] = Math.sin(seed.angle) * radius * squash;
        streakPositions[end + 2] = -1.45 + seed.depth * 1.35;
        streakPositions[end + 3] = Math.cos(seed.angle) * (radius - length);
        streakPositions[end + 4] = Math.sin(seed.angle) * (radius - length) * squash;
        streakPositions[end + 5] = streakPositions[end + 2];
      });
      streakAttribute.needsUpdate = true;
      streakMaterial.opacity = warpStrength * 0.62;

      renderer.render(scene, camera);
    };

    const observer = new IntersectionObserver(
      ([entry]) => {
        visible = entry?.isIntersecting ?? false;
      },
      { rootMargin: "30% 0px" },
    );
    observer.observe(root);
    resize();
    window.addEventListener("resize", resize);
    frame = window.requestAnimationFrame(render);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      observer.disconnect();
      disposeScene(scene);
      renderer.dispose();
    };
  }, []);

  return (
    <section
      ref={rootRef}
      className="hero-rail-gateway"
      aria-label="DJL 任务进入六种能力轨道"
      data-reduced="false"
      data-auto-transition="hero-ready"
    >
      <canvas ref={canvasRef} className="hrg-canvas" aria-hidden="true" />
      <div className="hrg-grid" aria-hidden="true" />
      <div className="hrg-blue-veil" aria-hidden="true" />
      <div className="hrg-reduced-line" aria-hidden="true" />

      <div className="hrg-copy hrg-copy-entry">
        <small>DJL / CONTEXT HANDOFF</small>
        <h2>任务已唤醒</h2>
        <p>继续滚动，让任务核穿过边界并进入六种能力。</p>
      </div>

      <div className="hrg-copy hrg-copy-exit">
        <small>CONTEXT PRESERVED</small>
        <h2>同一任务，完整上下文</h2>
        <p>任务核即将落入本地能力槽，后续每一步都沿用同一上下文。</p>
      </div>

      <div className="hrg-capabilities" aria-hidden="true">
        {["本地", "在线", "双语", "工具", "生产", "密钥"].map((item, index) => (
          <span key={item} style={{ "--hrg-index": index } as CSSProperties}>
            <i />
            {item}
          </span>
        ))}
      </div>

      <dl className="hrg-stats" aria-label="DJL 平台关键指标">
        {stats.map((stat, index) => (
          <div key={stat.k} style={{ "--hrg-stat-index": index } as CSSProperties}>
            <dt>{stat.k}</dt>
            <dd>{stat.v}</dd>
          </div>
        ))}
      </dl>

      <div className="hrg-progress" aria-hidden="true">
        <span>ONE FLICK · AUTO TRANSFER</span>
        <i><b /></i>
        <em>01 / 06</em>
      </div>
    </section>
  );
}
