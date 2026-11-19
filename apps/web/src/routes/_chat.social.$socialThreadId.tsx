import { multiPostViews } from "~/components/multipost/shared";
import { ThreadId } from "@synara/contracts";
import { createFileRoute } from "@tanstack/react-router";
import ChatView from "~/components/ChatView";

export const Route = createFileRoute("/_chat/social/$socialThreadId")({
  validateSearch: (search: Record<string, unknown>) => {
    const view = multiPostViews.find((value) => value === search.multipostView);
    return {
      ...(view ? { multipostView: view } : {}),
      ...(typeof search.workflowId === "string" ? { workflowId: search.workflowId } : {}),
    };
  },
  component: SocialToolsRoute,
});

function SocialToolsRoute() {
  const { socialThreadId } = Route.useParams();
  const { multipostView: view, workflowId } = Route.useSearch();
  return (
    <ChatView
      key={`${socialThreadId}:${view ?? "compose"}:${workflowId ?? ""}`}
      threadId={ThreadId.makeUnsafe(socialThreadId)}
      socialToolsPage
      {...(view ? { socialToolsInitialView: view } : {})}
      {...(workflowId ? { socialToolsWorkflowId: workflowId } : {})}
    />
  );
}
