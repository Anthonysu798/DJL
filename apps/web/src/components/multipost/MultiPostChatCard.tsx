import { useQuery, useQueryClient } from "@tanstack/react-query";
import { multiPostState } from "./client";
import { MultiPostReview } from "./MultiPostReview";
export function MultiPostChatCard({ threadId }: { threadId: string }) {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["multipost", threadId],
    queryFn: () => multiPostState(threadId),
    retry: false,
    refetchInterval: 3000,
  });
  if (!query.data) return null;
  return (
    <>
      {query.data.drafts
        .filter(
          (d) =>
            d.threadId === threadId &&
            !query.data.jobs.some((j) => j.draftId === d.id && j.revision === d.revision),
        )
        .map((d) => (
          <MultiPostReview
            key={`${d.id}-${d.revision}`}
            threadId={threadId}
            draft={d}
            accounts={query.data.accounts}
            onUpdated={() => {
              void client.invalidateQueries({ queryKey: ["multipost"] });
            }}
          />
        ))}
    </>
  );
}
