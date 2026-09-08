import { createFileRoute } from "@tanstack/react-router";

import AgentWorkspacesView from "~/components/agent-workspaces/AgentWorkspacesView";

function KanbanOverviewRouteView() {
  return <AgentWorkspacesView projectId={null} />;
}

export const Route = createFileRoute("/_chat/kanban/")({
  component: KanbanOverviewRouteView,
});
