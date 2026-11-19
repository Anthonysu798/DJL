"use client";

/* eslint-disable react/no-array-index-key -- Fixed slot positions are their stable identity; characters animate inside them. */

// Adapted from the user's supplied React Bits CodeSlots example: the landing
// animation is retained, with one native input for alphanumeric device codes.
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useRef, useState, type CSSProperties } from "react";

import "./code-slots.css";

interface CodeSlotsProps {
  value: string;
  onChange: (code: string) => void;
  length?: number;
  id?: string;
  disabled?: boolean;
  invalid?: boolean;
  ariaLabel?: string;
  ariaDescribedBy?: string | undefined;
}

const normalize = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, "");

export default function CodeSlots({
  value,
  onChange,
  length = 8,
  id,
  disabled = false,
  invalid = false,
  ariaLabel,
  ariaDescribedBy,
}: CodeSlotsProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const reduce = useReducedMotion();
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(0);
  const code = normalize(value).slice(0, length);
  const slots = Array.from({ length }, (_, index) => code[index] ?? "");

  return (
    <div className="code-slots" style={{ "--cs-length": length } as CSSProperties}>
      <div
        className="code-slots__row"
        data-status={invalid ? "error" : "idle"}
        data-disabled={disabled || undefined}
      >
        <input
          ref={inputRef}
          id={id}
          className="code-slots__input"
          type="text"
          inputMode="text"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          value={code}
          disabled={disabled}
          aria-label={ariaLabel}
          aria-invalid={invalid}
          aria-describedby={ariaDescribedBy}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onSelect={(event) =>
            setActive(Math.min(event.currentTarget.selectionStart ?? 0, length - 1))
          }
          onPointerDown={(event) => {
            if (disabled || event.button !== 0) return;
            event.preventDefault();
            const input = event.currentTarget;
            const box = input.getBoundingClientRect();
            const index = Math.max(
              0,
              Math.min(
                code.length,
                length - 1,
                Math.floor((event.clientX - box.left) / (box.width / length)),
              ),
            );
            input.focus({ preventScroll: true });
            input.setSelectionRange(index, Math.min(index + 1, code.length));
            setActive(index);
          }}
          onChange={(event) => {
            const raw = event.currentTarget.value;
            const cursor = normalize(
              raw.slice(0, event.currentTarget.selectionStart ?? raw.length),
            ).length;
            onChange(normalize(raw).slice(0, length));
            // Keep native selection after uppercasing or removing pasted separators.
            queueMicrotask(() =>
              inputRef.current?.setSelectionRange(
                Math.min(cursor, length),
                Math.min(cursor, length),
              ),
            );
          }}
        />
        {slots.map((character, index) => (
          <span
            key={index}
            className="code-slots__slot"
            data-active={(focused && active === index) || undefined}
            aria-hidden="true"
          >
            <motion.span
              className="code-slots__fill"
              initial={false}
              animate={{ scale: character ? 1 : 0 }}
              transition={
                reduce ? { duration: 0 } : { type: "spring", duration: 0.3, bounce: 0.16 }
              }
            />
            <AnimatePresence initial={false}>
              {character && (
                <motion.span
                  key={character}
                  className="code-slots__digit"
                  initial={{ opacity: 0, y: reduce ? 0 : 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: reduce ? 0 : -5 }}
                  transition={{ duration: reduce ? 0 : 0.18 }}
                >
                  {character}
                </motion.span>
              )}
            </AnimatePresence>
            {!character && focused && active === index && <span className="code-slots__caret" />}
          </span>
        ))}
      </div>
    </div>
  );
}
