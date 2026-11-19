import type { MultiPostCommand, MultiPostState, MultiPostFile } from "@synara/contracts";
import { resolveWsHttpUrl } from "~/lib/wsHttpUrl";
export async function multiPostCommand<T = unknown>(
  threadId: string,
  command: MultiPostCommand,
): Promise<T> {
  const response = await fetch(resolveWsHttpUrl("/api/multipost/command"), {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ threadId, command }),
  });
  if (!response.ok)
    throw new Error((await response.text()).slice(0, 500) || "MultiPost request failed");
  return response.json() as Promise<T>;
}
export const multiPostState = (threadId: string) =>
  multiPostCommand<MultiPostState>(threadId, { action: "state" });
export async function uploadMultiPostMedia(threadId: string, file: File): Promise<MultiPostFile> {
  const response = await fetch(
    resolveWsHttpUrl(`/api/multipost/media?threadId=${encodeURIComponent(threadId)}`),
    {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": file.type || "application/octet-stream",
        "X-DJL-Filename": encodeURIComponent(file.name),
      },
      body: file,
    },
  );
  if (!response.ok) throw new Error((await response.text()).slice(0, 400));
  return response.json() as Promise<MultiPostFile>;
}
export function mediaPreviewUrl(threadId: string, url: string) {
  return url.startsWith("Media/")
    ? resolveWsHttpUrl(
        `/api/multipost/media/${encodeURIComponent(url.slice(6))}?threadId=${encodeURIComponent(threadId)}`,
      )
    : url.startsWith("https://")
      ? url
      : resolveWsHttpUrl(
          `/api/multipost/media/source?threadId=${encodeURIComponent(threadId)}&path=${encodeURIComponent(url)}`,
        );
}
