// FILE: _chat.work.index.tsx
// Purpose: Public route for the task-oriented DJL Work surface.
// Layer: Routing

import { createFileRoute } from "@tanstack/react-router";

import { WorkIndexRouteView } from "../components/work/WorkIndexRouteView";

export const Route = createFileRoute("/_chat/work/")({
  component: WorkIndexRouteView,
});
