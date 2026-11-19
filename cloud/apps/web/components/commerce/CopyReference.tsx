"use client";

import { Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import styles from "./shop.module.css";

export function CopyReference({ label, value }: { label: string; value: string }) {
  const [phase, setPhase] = useState<"idle" | "copying" | "copied" | "manual">("idle");
  const input = useRef<HTMLInputElement>(null);
  const current = useRef({ active: false, pending: false });

  useEffect(() => {
    const request = { active: true, pending: false };
    current.current = request;
    setPhase("idle");
    return () => {
      request.active = false;
    };
  }, [label, value]);
  useEffect(() => {
    if (phase === "manual") {
      input.current?.focus();
      input.current?.select();
    }
  }, [phase]);

  async function copy() {
    const request = current.current;
    if (!request.active || request.pending) return;
    request.pending = true;
    setPhase("copying");
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(value);
      if (request.active) setPhase("copied");
    } catch {
      if (request.active) setPhase("manual");
    } finally {
      request.pending = false;
    }
  }

  return (
    <div>
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.secondary}
          disabled={phase === "copying" || !value.trim()}
          onClick={() => void copy()}
        >
          <Copy size={15} aria-hidden="true" />
          {phase === "copying" ? "正在复制…" : `复制${label}`}
        </button>
        {phase === "copied" || phase === "manual" ? (
          <span className={styles.small} role="status">
            {phase === "copied" ? `${label}已复制。` : "浏览器未完成复制，请手动复制。"}
          </span>
        ) : null}
      </div>
      {phase === "manual" ? (
        <label className={styles.field}>
          长按或按 Ctrl/Cmd+C 复制
          <input ref={input} aria-label={`手动复制${label}`} value={value} readOnly />
        </label>
      ) : null}
    </div>
  );
}
