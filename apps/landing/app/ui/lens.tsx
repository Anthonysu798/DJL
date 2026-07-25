"use client";

// Magic UI — Lens
import { type ReactNode, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";

interface Position {
  x: number;
  y: number;
}

interface LensProps {
  children: ReactNode;
  zoomFactor?: number;
  lensSize?: number;
  position?: Position;
  defaultPosition?: Position;
  isStatic?: boolean;
  duration?: number;
  lensColor?: string;
  ariaLabel?: string;
}

export function Lens({
  children,
  zoomFactor = 1.4,
  lensSize = 180,
  isStatic = false,
  position = { x: 200, y: 150 },
  defaultPosition,
  duration = 0.1,
  lensColor = "#000",
  ariaLabel = "Zoom Area",
}: LensProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [mousePosition, setMousePosition] = useState<Position>({ x: 100, y: 100 });
  const [isHovering, setIsHovering] = useState(false);

  const currentPosition = isStatic ? position : (defaultPosition ?? mousePosition);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setMousePosition({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  const maskFor = (p: Position) =>
    `radial-gradient(circle ${lensSize / 2}px at ${p.x}px ${p.y}px, ${lensColor} 100%, transparent 100%)`;

  const renderLens = (p: Position) => (
    <motion.div
      initial={{ opacity: 0, scale: 0.58 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.8 }}
      transition={{ duration }}
      className="absolute inset-0 overflow-hidden"
      style={{
        maskImage: maskFor(p),
        WebkitMaskImage: maskFor(p),
        transformOrigin: `${p.x}px ${p.y}px`,
        zIndex: 50,
      }}
    >
      <div
        style={{
          transform: `scale(${zoomFactor})`,
          transformOrigin: `${p.x}px ${p.y}px`,
        }}
      >
        {children}
      </div>
    </motion.div>
  );

  return (
    <div
      ref={containerRef}
      onMouseMove={handleMouseMove}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
      className="relative z-20 overflow-hidden rounded-xl"
      role="region"
      aria-label={ariaLabel}
    >
      {children}
      {isStatic || defaultPosition ? (
        renderLens(currentPosition)
      ) : (
        <AnimatePresence mode="popLayout">
          {isHovering && renderLens(mousePosition)}
        </AnimatePresence>
      )}
    </div>
  );
}
