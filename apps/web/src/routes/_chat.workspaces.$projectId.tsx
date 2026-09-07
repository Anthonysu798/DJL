import { createFileRoute } from "@tanstack/react-router";

import AgentWorkspacesView from "~/components/agent-workspaces/AgentWorkspacesView";

function WorkspacesProjectRouteView() {
  const { projectId } = Route.useParams();
  return <AgentWorkspacesView projectId={projectId} />;
}

export const Route = createFileRoute("/_chat/workspaces/$projectId")({
  component: WorkspacesProjectRouteView,
});
