import { createFileRoute } from "@tanstack/react-router";

import AgentWorkspacesView from "~/components/agent-workspaces/AgentWorkspacesView";

function WorkspacesOverviewRouteView() {
  return <AgentWorkspacesView projectId={null} />;
}

export const Route = createFileRoute("/_chat/workspaces/")({
  component: WorkspacesOverviewRouteView,
});
