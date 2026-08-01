"use client";

import { useEffect, useRef, useState } from "react";
import { Play } from "lucide-react";
import { AppWindowSkeleton } from "./AppWindowSkeleton";
import "./app-window-video.css";

// The product-loop demo video. Drop the assets at:
//   public/demo/product-loop.mp4          (H.264, muted loop, +faststart, ~1600px wide)
//   public/demo/product-loop-poster.webp  (first frame)
// Until the video exists this renders the skeleton, so it ships ahead of the
// recording. Autoplays muted only while on screen; under reduced motion it
// waits for a tap on the play control instead.
const VIDEO_SRC = "/demo/product-loop.mp4";
const POSTER_SRC = "/demo/product-loop-poster.webp";

export function AppWindowVideo({ label }: { label: string }) {
  const [status, setStatus] = useState<"checking" | "ready" | "missing">("checking");
  const [reduceMotion, setReduceMotion] = useState(false);
  const [manualStarted, setManualStarted] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    setReduceMotion(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    let cancelled = false;
    fetch(VIDEO_SRC, { method: "HEAD" })
      .then((response) => {
        if (!cancelled) setStatus(response.ok ? "ready" : "missing");
      })
      .catch(() => {
        if (!cancelled) setStatus("missing");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Play only while at least a third of the frame is on screen.
  useEffect(() => {
    if (status !== "ready" || reduceMotion) return;
    const video = videoRef.current;
    if (!video) return;
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) video.play().catch(() => {});
          else video.pause();
        });
      },
      { threshold: 0.35 },
    );
    observer.observe(video);
    return () => observer.disconnect();
  }, [status, reduceMotion]);

  if (status !== "ready") return <AppWindowSkeleton />;

  return (
    <div className="awv">
      <video
        ref={videoRef}
        src={VIDEO_SRC}
        poster={POSTER_SRC}
        muted
        loop
        playsInline
        preload={reduceMotion ? "metadata" : "none"}
        aria-label={label}
        onClick={
          reduceMotion
            ? () => {
                const video = videoRef.current;
                if (!video) return;
                if (video.paused) video.play().catch(() => {});
                else video.pause();
              }
            : undefined
        }
      />
      {reduceMotion && !manualStarted && (
        <button
          type="button"
          className="awv-play"
          aria-label={label}
          onClick={() => {
            setManualStarted(true);
            videoRef.current?.play().catch(() => {});
          }}
        >
          <Play size={18} fill="currentColor" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
