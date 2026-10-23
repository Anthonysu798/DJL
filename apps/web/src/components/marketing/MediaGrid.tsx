import { useEffect, useRef, useState, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { MediaAsset } from "@synara/contracts";
export function MediaGrid({
  assets,
  render,
}: {
  assets: MediaAsset[];
  render: (asset: MediaAsset) => ReactNode;
}) {
  const scroll = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState(3);
  useEffect(() => {
    if (!scroll.current) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setColumns(Math.max(1, Math.floor(entry.contentRect.width / 205)));
    });
    observer.observe(scroll.current);
    return () => observer.disconnect();
  }, []);
  const rows = useVirtualizer({
    count: Math.ceil(assets.length / columns),
    getScrollElement: () => scroll.current,
    estimateSize: () => 255,
    overscan: 2,
  });
  return (
    <div ref={scroll} style={{ height: "min(65vh,760px)", overflow: "auto" }}>
      <div style={{ height: rows.getTotalSize(), position: "relative" }}>
        {rows.getVirtualItems().map((row) => (
          <div
            key={row.key}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              transform: `translateY(${row.start}px)`,
              display: "grid",
              gridTemplateColumns: `repeat(${columns},minmax(0,1fr))`,
              gap: 15,
            }}
          >
            {assets.slice(row.index * columns, (row.index + 1) * columns).map(render)}
          </div>
        ))}
      </div>
    </div>
  );
}
