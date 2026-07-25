// FILE: notificationIcon.ts
// Purpose: Keep native desktop notifications on DJL-owned brand assets.

export function resolveNotificationIconAssetName(platform: NodeJS.Platform): "icon.png" | null {
  // macOS uses the application bundle icon for native notifications.
  return platform === "darwin" ? null : "icon.png";
}
