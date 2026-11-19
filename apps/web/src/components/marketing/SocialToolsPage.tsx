import type { MultiPostView } from "../multipost/shared";
import MultiPostWorkspace from "../multipost/MultiPostWorkspace";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { RouteInsetSurface } from "~/components/RouteInsetSurface";
import { Button } from "~/components/ui/button";
import { loadThreadMarketing } from "./client";
import SocialAgentWorkspace from "./SocialAgentWorkspace";

export default function SocialToolsPage({
  threadId,
  onPrompt,
  onBack,
  initialView,
  initialWorkflowId,
}: {
  initialView?: MultiPostView;
  initialWorkflowId?: string;
  threadId: string;
  onPrompt: (text: string) => Promise<boolean>;
  onBack: () => void;
}) {
  const { t } = useTranslation("chat");
  const query = useQuery({
    queryKey: ["marketing-chat", threadId],
    queryFn: () => loadThreadMarketing(threadId),
    refetchInterval: 10000,
    retry: false,
  });
  return (
    <RouteInsetSurface>
      {query.isError && (
        <div role="alert" className="flex items-center gap-3 px-6 py-3 text-sm text-destructive">
          {query.error.message}
          <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
            {t("socialAgent.retry", { defaultValue: "Try again" })}
          </Button>
        </div>
      )}
      <MultiPostWorkspace
        {...(initialView ? { initialView } : {})}
        {...(initialWorkflowId ? { initialWorkflowId } : {})}
        {...(query.data?.campaigns[0]
          ? {
              legacyCampaign: {
                id: query.data.campaigns[0].value.id,
                version: query.data.campaigns[0].version,
              },
            }
          : {})}
        threadId={threadId}
        onBack={onBack}
        onPrompt={onPrompt}
        resources={
          <SocialAgentWorkspace
            key={threadId}
            threadId={threadId}
            assets={query.data?.assets.map((asset) => asset.value) ?? []}
            {...(query.data?.campaigns[0] ? { campaign: query.data.campaigns[0] } : {})}
            onPrompt={onPrompt}
            onBack={onBack}
          />
        }
      />
    </RouteInsetSurface>
  );
}
