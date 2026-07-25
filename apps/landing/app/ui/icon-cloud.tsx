"use client";

// Magic UI — Icon Cloud (interactive 3D tag cloud, canvas based)
import { useEffect, useMemo, useRef } from "react";

interface Icon {
  x: number;
  y: number;
  z: number;
  id: number;
}

interface IconCloudProps {
  images?: string[];
  size?: number;
}

function easeOut(t: number) {
  return 1 - Math.pow(1 - t, 3);
}

export function IconCloud({ images = [], size = 340 }: IconCloudProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rotationRef = useRef({ x: 0, y: 0 });
  const iconCanvasesRef = useRef<HTMLCanvasElement[]>([]);
  const loadedRef = useRef<boolean[]>([]);
  const rafRef = useRef(0);
  const mouseRef = useRef({ x: 0, y: 0, inside: false });
  const dragRef = useRef({ active: false, lastX: 0, lastY: 0 });
  const targetRef = useRef<{
    x: number;
    y: number;
    startX: number;
    startY: number;
    startTime: number;
  } | null>(null);

  // build offscreen circular icon canvases from image URLs
  useEffect(() => {
    if (!images.length) return;
    loadedRef.current = new Array(images.length).fill(false);
    iconCanvasesRef.current = images.map((src, index) => {
      const off = document.createElement("canvas");
      off.width = 44;
      off.height = 44;
      const ctx = off.getContext("2d");
      if (ctx) {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.src = src;
        img.onload = () => {
          ctx.clearRect(0, 0, 44, 44);
          ctx.drawImage(img, 4, 4, 36, 36);
          loadedRef.current[index] = true;
        };
      }
      return off;
    });
  }, [images]);

  const positions = useMemo(() => {
    const n = images.length || 24;
    const out: Icon[] = [];
    const offset = 2 / n;
    const increment = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < n; i++) {
      const y = i * offset - 1 + offset / 2;
      const r = Math.sqrt(1 - y * y);
      const phi = i * increment;
      out.push({
        x: Math.cos(phi) * r * 100,
        y: y * 100,
        z: Math.sin(phi) * r * 100,
        id: i,
      });
    }
    return out;
  }, [images.length]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.scale(dpr, dpr);

    const animate = () => {
      ctx.clearRect(0, 0, size, size);
      const cx = size / 2;
      const cy = size / 2;

      if (targetRef.current) {
        const t = targetRef.current;
        const elapsed = (performance.now() - t.startTime) / 1000;
        const p = Math.min(easeOut(elapsed / 0.8), 1);
        rotationRef.current = {
          x: t.startX + (t.x - t.startX) * p,
          y: t.startY + (t.y - t.startY) * p,
        };
        if (p >= 1) targetRef.current = null;
      } else if (!dragRef.current.active) {
        if (mouseRef.current.inside) {
          const dx = mouseRef.current.x - cx;
          const dy = mouseRef.current.y - cy;
          rotationRef.current.y += (dx / size) * 0.012;
          rotationRef.current.x += (dy / size) * 0.012;
        } else {
          rotationRef.current.y += 0.0035;
          rotationRef.current.x += 0.0008;
        }
      }

      const cosX = Math.cos(rotationRef.current.x);
      const sinX = Math.sin(rotationRef.current.x);
      const cosY = Math.cos(rotationRef.current.y);
      const sinY = Math.sin(rotationRef.current.y);

      const projected = positions.map((icon) => {
        const rx = icon.x * cosY - icon.z * sinY;
        const rz = icon.x * sinY + icon.z * cosY;
        const ry = icon.y * cosX + rz * sinX;
        const fz = rz * cosX - icon.y * sinX;
        return { icon, rx, ry, fz };
      });
      projected.sort((a, b) => a.fz - b.fz);

      for (const { icon, rx, ry, fz } of projected) {
        const scale = (fz + 200) / 320;
        const opacity = Math.max(0.18, Math.min(1, (fz + 140) / 220));
        ctx.save();
        ctx.translate(cx + rx, cy + ry);
        ctx.scale(scale, scale);
        ctx.globalAlpha = opacity;
        const off = iconCanvasesRef.current[icon.id];
        if (off && loadedRef.current[icon.id]) {
          ctx.drawImage(off, -22, -22, 44, 44);
        } else {
          ctx.beginPath();
          ctx.arc(0, 0, 15, 0, Math.PI * 2);
          ctx.strokeStyle = "rgba(236,237,244,0.22)";
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
        ctx.restore();
      }
      rafRef.current = requestAnimationFrame(animate);
    };
    rafRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafRef.current);
  }, [positions, size]);

  const onMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    mouseRef.current = { x, y, inside: true };
    if (dragRef.current.active) {
      const dx = x - dragRef.current.lastX;
      const dy = y - dragRef.current.lastY;
      rotationRef.current.y += dx * 0.006;
      rotationRef.current.x += dy * 0.006;
      dragRef.current.lastX = x;
      dragRef.current.lastY = y;
    }
  };

  return (
    <canvas
      ref={canvasRef}
      style={{ width: size, height: size }}
      className="cursor-grab active:cursor-grabbing"
      role="img"
      aria-label="Interactive 3D cloud of supported tools and runtimes"
      onMouseMove={onMove}
      onMouseLeave={() => {
        mouseRef.current.inside = false;
        dragRef.current.active = false;
      }}
      onMouseDown={(e) => {
        const rect = canvasRef.current!.getBoundingClientRect();
        dragRef.current = {
          active: true,
          lastX: e.clientX - rect.left,
          lastY: e.clientY - rect.top,
        };
      }}
      onMouseUp={() => {
        dragRef.current.active = false;
      }}
    />
  );
}
