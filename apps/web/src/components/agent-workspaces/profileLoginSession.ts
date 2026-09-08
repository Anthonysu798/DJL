import type { NativeApi } from "@synara/contracts";
import type { AgentAccountProfile } from "~/agentWorkspaceStore";
import { randomUUID } from "~/lib/utils";

// This terminal belongs to the sign-in dialog, independently of workspace panes.
export function createProfileLoginSession(
  api: NativeApi,
  profile: AgentAccountProfile,
  onOutput?: (data: string) => void,
) {
  const ids = { threadId: `profile-login-${randomUUID()}`, terminalId: "default" };
  let cancelled = false;
  const unsubscribe = onOutput
    ? api.terminal.onEvent((event) => {
        if (
          !cancelled &&
          event.type === "output" &&
          event.threadId === ids.threadId &&
          event.terminalId === ids.terminalId
        )
          onOutput(event.data);
      })
    : () => {};
  let closing: Promise<void> | null = null;
  const ready = (async () => {
    const config = await api.server.getConfig();
    if (cancelled) return null;
    const input = {
      ...ids,
      cwd: config.homeDir ?? config.cwd,
      agentProfile: { provider: profile.provider, profileId: profile.id, action: "login" as const },
    };
    const snapshot = await api.terminal.open({
      ...input,
      includeHistory: false,
      headlessQueries: true,
    });
    if (snapshot.status === "error") throw new Error("Sign-in terminal could not start.");
    return { ...input, serverHandlesQueries: snapshot.headlessQueries === true };
  })();
  return {
    ready,
    close() {
      cancelled = true;
      unsubscribe();
      closing ??= ready
        .catch(() => null)
        .then(() => api.terminal.close({ ...ids, deleteHistory: true }))
        .catch((error) => {
          closing = null;
          throw error;
        });
      return closing;
    },
  };
}

const SIGN_IN_HOSTS = {
  codex: ["auth.openai.com"],
  claudeAgent: ["claude.ai", "platform.claude.com", "console.anthropic.com"],
  cursor: ["cursor.com", "www.cursor.com", "auth.cursor.com"],
  opencode: ["opencode.ai", "auth.openai.com", "claude.ai", "platform.claude.com"],
};
export function providerSignInUrl(
  provider: AgentAccountProfile["provider"],
  output: string,
): string | null {
  const text = output.replace(
    new RegExp(String.fromCharCode(27) + "\\[[0-?]*[ -/]*[@-~]", "g"),
    "",
  );
  for (const candidate of text.match(/https:\/\/[^\s<>]+(?=\s)/g) ?? []) {
    try {
      const url = new URL(candidate);
      if (
        !url.username &&
        !url.password &&
        SIGN_IN_HOSTS[provider].includes(url.hostname) &&
        /auth|login/.test(url.pathname)
      )
        return url.href;
    } catch {
      /* Ignore incomplete chunks and non-login links. */
    }
  }
  return null;
}
