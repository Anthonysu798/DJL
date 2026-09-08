import { createFileRoute } from "@tanstack/react-router";

import AgentWorkspacesView from "~/components/agent-workspaces/AgentWorkspacesView";

function KanbanProjectRouteView() {
  const { projectId } = Route.useParams();
  return <AgentWorkspacesView projectId={projectId} />;
}

export const Route = createFileRoute("/_chat/kanban/$projectId")({
  component: KanbanProjectRouteView,
});
