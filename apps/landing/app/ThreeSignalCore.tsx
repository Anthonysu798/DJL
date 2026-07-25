"use client";

import { useEffect, useRef } from "react";
import { useReducedMotion } from "./effects";

export function ThreeSignalCore({ className = "" }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let cancelled = false;
    let cleanup = () => {};

    void import("three").then((THREE) => {
      if (cancelled || !canvas.isConnected) return;

      const renderer = new THREE.WebGLRenderer({
        canvas,
        alpha: true,
        antialias: true,
        powerPreference: "high-performance",
      });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
      renderer.outputColorSpace = THREE.SRGBColorSpace;

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
      camera.position.set(0, 0, 6.2);

      const group = new THREE.Group();
      scene.add(group);

      const coreGeometry = new THREE.IcosahedronGeometry(1.05, 2);
      const coreMaterial = new THREE.MeshBasicMaterial({
        color: 0xffb454,
        wireframe: true,
        transparent: true,
        opacity: 0.72,
      });
      const core = new THREE.Mesh(coreGeometry, coreMaterial);
      group.add(core);

      const shellGeometry = new THREE.TorusGeometry(1.78, 0.008, 8, 120);
      const ringMaterial = new THREE.MeshBasicMaterial({
        color: 0xffb454,
        transparent: true,
        opacity: 0.5,
      });
      const rings = [0, 1, 2].map((i) => {
        const ring = new THREE.Mesh(shellGeometry, ringMaterial.clone());
        ring.rotation.x = i === 0 ? Math.PI / 2 : Math.PI / 2.7;
        ring.rotation.y = i === 1 ? Math.PI / 2.8 : -Math.PI / 5;
        ring.rotation.z = i * 0.65;
        group.add(ring);
        return ring;
      });

      const pointCount = 180;
      const positions = new Float32Array(pointCount * 3);
      for (let i = 0; i < pointCount; i += 1) {
        const r = 1.45 + ((i * 37) % 100) / 75;
        const theta = i * 2.399963;
        const phi = Math.acos(1 - (2 * (i + 0.5)) / pointCount);
        positions[i * 3] = Math.cos(theta) * Math.sin(phi) * r;
        positions[i * 3 + 1] = Math.sin(theta) * Math.sin(phi) * r;
        positions[i * 3 + 2] = Math.cos(phi) * r;
      }
      const pointsGeometry = new THREE.BufferGeometry();
      pointsGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      const pointsMaterial = new THREE.PointsMaterial({
        color: 0x5aa9ff,
        size: 0.025,
        transparent: true,
        opacity: 0.62,
        depthWrite: false,
      });
      const points = new THREE.Points(pointsGeometry, pointsMaterial);
      group.add(points);

      let raf = 0;
      let visible = true;
      const startTime = performance.now();

      const resize = () => {
        const rect = canvas.getBoundingClientRect();
        const width = Math.max(1, rect.width);
        const height = Math.max(1, rect.height);
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
      };

      const render = () => {
        const t = (performance.now() - startTime) / 1000;
        group.rotation.y = t * 0.18;
        group.rotation.x = Math.sin(t * 0.32) * 0.12;
        core.rotation.y = t * 0.42;
        core.rotation.z = t * 0.18;
        points.rotation.y = -t * 0.08;
        rings.forEach((ring, i) => {
          ring.rotation.z += 0.0018 + i * 0.0007;
        });
        renderer.render(scene, camera);
      };

      const loop = () => {
        render();
        if (!reduced && visible && !document.hidden) {
          raf = requestAnimationFrame(loop);
        }
      };

      const observer = new IntersectionObserver(([entry]) => {
        visible = entry?.isIntersecting ?? true;
        cancelAnimationFrame(raf);
        if (!reduced && visible && !document.hidden) {
          raf = requestAnimationFrame(loop);
        }
      });

      const onVisibility = () => {
        cancelAnimationFrame(raf);
        if (!document.hidden && visible && !reduced) {
          raf = requestAnimationFrame(loop);
        }
      };

      resize();
      render();
      observer.observe(canvas);
      window.addEventListener("resize", resize);
      document.addEventListener("visibilitychange", onVisibility);
      if (!reduced) raf = requestAnimationFrame(loop);

      cleanup = () => {
        cancelAnimationFrame(raf);
        observer.disconnect();
        window.removeEventListener("resize", resize);
        document.removeEventListener("visibilitychange", onVisibility);
        coreGeometry.dispose();
        coreMaterial.dispose();
        shellGeometry.dispose();
        ringMaterial.dispose();
        rings.forEach((ring) => {
          if (Array.isArray(ring.material)) ring.material.forEach((m) => m.dispose());
          else ring.material.dispose();
        });
        pointsGeometry.dispose();
        pointsMaterial.dispose();
        renderer.dispose();
      };
    });

    return () => {
      cancelled = true;
      cleanup();
    };
  }, [reduced]);

  return <canvas ref={canvasRef} className={`three-core ${className}`} aria-hidden="true" />;
}
