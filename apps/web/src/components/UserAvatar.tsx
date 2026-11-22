// FILE: UserAvatar.tsx
// Purpose: The account avatar: a soft gradient picked from the email, with the person's
//          initials on it (a person glyph when signed out). Drawn locally, so the email
//          never leaves the app to fetch a picture.
// Layer: UI component

import { useId } from "react";

import { CentralIcon } from "~/lib/central-icons";
import { cn } from "~/lib/utils";

// Pairs that read well in light and dark and keep white initials legible (WCAG AA at 600+).
const PALETTES: ReadonlyArray<readonly [string, string, string]> = [
  ["#6366f1", "#a855f7", "#ec4899"],
  ["#0ea5e9", "#6366f1", "#22d3ee"],
  ["#10b981", "#0ea5e9", "#84cc16"],
  ["#f97316", "#ef4444", "#f59e0b"],
  ["#14b8a6", "#3b82f6", "#a78bfa"],
  ["#e11d48", "#9333ea", "#fb7185"],
  ["#2563eb", "#0d9488", "#38bdf8"],
  ["#d946ef", "#6366f1", "#f472b6"],
];

function hash(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** "ada.lovelace@x.com" → "AL"; "ada@x.com" → "AD". */
export function avatarInitials(email: string): string {
  const local = email.split("@")[0] ?? "";
  const parts = local.split(/[._\-+]+/).filter(Boolean);
  const letters =
    parts.length >= 2 ? `${parts[0]![0]}${parts[1]![0]}` : (parts[0] ?? "").slice(0, 2);
  return letters.toUpperCase();
}

export function UserAvatar(props: {
  /** The signed-in email; without it the avatar shows a person glyph instead of initials. */
  email: string | undefined;
  size: number;
  className?: string;
}) {
  const id = useId();
  const style = { width: props.size, height: props.size };
  // Signed out: the same gradient tile with a person glyph, so the rail never shows a grey hole.
  const seed = props.email ? hash(props.email.toLowerCase()) : 0;
  const [a, b, c] = PALETTES[seed % PALETTES.length]!;
  const angle = (seed >> 8) % 360;
  const cx = 20 + ((seed >> 4) % 60);
  const cy = 20 + ((seed >> 12) % 60);
  return (
    <span
      aria-hidden
      style={style}
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full ring-1 ring-black/5 dark:ring-white/10",
        props.className,
      )}
      data-slot="user-avatar"
    >
      <svg viewBox="0 0 100 100" className="absolute inset-0 size-full">
        <defs>
          <linearGradient id={`${id}-base`} gradientTransform={`rotate(${angle} .5 .5)`}>
            <stop offset="0" stopColor={a} />
            <stop offset="1" stopColor={b} />
          </linearGradient>
          <radialGradient id={`${id}-glow`} cx={`${cx}%`} cy={`${cy}%`} r="60%">
            <stop offset="0" stopColor={c} stopOpacity="0.9" />
            <stop offset="1" stopColor={c} stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width="100" height="100" fill={`url(#${id}-base)`} />
        <rect width="100" height="100" fill={`url(#${id}-glow)`} />
      </svg>
      {props.email ? (
        <span
          className="relative font-semibold tracking-wide text-white drop-shadow-[0_1px_1px_rgb(0_0_0/0.25)]"
          style={{ fontSize: Math.round(props.size * 0.36) }}
        >
          {avatarInitials(props.email)}
        </span>
      ) : (
        <CentralIcon name="user" className="relative size-[46%] text-white" />
      )}
    </span>
  );
}
