// FILE: notificationSurface.ts
// Purpose: Shared visual tokens for transient and inline notification surfaces.
// Layer: UI styling helper
// Exports: notification surface class names used by toast and status banners.

// `--notification-fg` keeps the text/icon/control color readable against the
// accent-tinted surface. It tracks the theme's own foreground token, so it is
// near-black in light themes and near-white in dark themes automatically —
// without depending on the `.dark` class. Children reference it via
// `text-[var(--notification-fg)]` so the contrast fix lives in one place for
// both toasts and inline notification banners.
const NOTIFICATION_FOREGROUND_CLASS_NAME =
  "text-[var(--notification-fg)] [--notification-fg:var(--color-text-foreground)]";

// `[-webkit-app-region:no-drag]` keeps the card (and every control inside it,
// notably the dismiss "X") clickable in the desktop app. Toasts render at the
// top edge over Electron's draggable titlebar region; without this the OS
// captures clicks in that band for window dragging and the X stops working.
//
// The surface is the shared liquid glass (`.glass-surface`, index.css) with the
// accent mixed into its fill and hairline border, so notifications keep their
// accent identity in both glass modes.
const NOTIFICATION_GLASS_SURFACE_CLASS_NAME = `glass-surface border-[color-mix(in_oklab,var(--color-text-accent)_14%,var(--glass-border))] bg-[color-mix(in_oklab,var(--color-text-accent)_10%,var(--glass-fill))] ${NOTIFICATION_FOREGROUND_CLASS_NAME} [-webkit-app-region:no-drag]`;

export const COMPACT_NOTIFICATION_SURFACE_CLASS_NAME = `w-max max-w-[min(calc(100vw-2rem),28rem)] rounded-xl ${NOTIFICATION_GLASS_SURFACE_CLASS_NAME}`;

export const EXPANDED_NOTIFICATION_SURFACE_CLASS_NAME = `w-full rounded-2xl ${NOTIFICATION_GLASS_SURFACE_CLASS_NAME}`;

export const NOTIFICATION_ICON_CLASS_NAME = "text-[var(--notification-fg)]/92";
