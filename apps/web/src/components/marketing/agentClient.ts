import { resolveWsHttpUrl } from "~/lib/wsHttpUrl";

export async function agentCommand<T>(
  threadId: string,
  tool: string,
  args: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(resolveWsHttpUrl("/api/marketing/agent"), {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ threadId, tool, args }),
  });
  if (!response.ok)
    throw new Error(
      (await response.text()).slice(0, 400) ||
        "The social workspace could not complete this action.",
    );
  return response.json() as Promise<T>;
}
