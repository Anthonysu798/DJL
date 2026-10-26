"use client";

import { invalid } from "@/components/Field";
import { Input } from "@/components/ui/input";

import styles from "./login.module.css";

export function VerificationCode({
  id,
  value,
  onChange,
  disabled,
  error,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  error: string | undefined;
}) {
  return (
    <div className={styles.codeControl} data-invalid={!!error} data-disabled={disabled}>
      <Input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value.replace(/\D/g, "").slice(0, 6))}
        inputMode="numeric"
        autoComplete="one-time-code"
        disabled={disabled}
        className={styles.codeInput}
        {...invalid(id, error)}
      />
      <div className={styles.codeSlots} aria-hidden="true">
        {Array.from({ length: 6 }, (_, index) => (
          <span key={index} data-active={index === Math.min(value.length, 5)}>
            {value[index] ?? ""}
          </span>
        ))}
      </div>
    </div>
  );
}
