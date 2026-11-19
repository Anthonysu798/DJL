// FILE: _chat.multi-agents.tsx
// Purpose: Registers the Multi agents group chat section under the shared chat shell.
// Layer: Route
// Exports: Route

import { GroupId } from "@synara/contracts";
import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { MultiAgentsScreen } from "~/multiAgents/MultiAgentsScreen";

type MultiAgentsSearch = { group?: string };

function MultiAgentsRoute() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  return (
    <MultiAgentsScreen
      selectedGroupId={search.group ? GroupId.makeUnsafe(search.group) : undefined}
      onSelectGroup={(groupId) =>
        void navigate({ to: "/multi-agents", search: groupId ? { group: groupId } : {} })
      }
    />
  );
}

export const Route = createFileRoute("/_chat/multi-agents")({
  validateSearch: (search: Record<string, unknown>): MultiAgentsSearch =>
    typeof search.group === "string" && search.group ? { group: search.group } : {},
  component: MultiAgentsRoute,
});
