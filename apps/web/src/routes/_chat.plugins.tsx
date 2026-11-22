// FILE: _chat.plugins.tsx
// Purpose: Layout-only route so the plugin directory (/plugins) and a plugin's page
//          (/plugins/$pluginId) each render as their own full page.
// Layer: Route
// Exports: Route

import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_chat/plugins")({
  component: PluginsLayout,
});

function PluginsLayout() {
  return <Outlet />;
}
