// FILE: _chat.plugins.$pluginId.tsx
// Purpose: Layout-only route so a plugin's detail page and its manage page each render alone.
// Layer: Route
// Exports: Route

import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_chat/plugins/$pluginId")({
  component: PluginLayout,
});

function PluginLayout() {
  return <Outlet />;
}
