import { PROVIDER_DISPLAY_NAMES, ThreadId } from "@synara/contracts";
import { page } from "vitest/browser";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { useComposerDraftStore } from "../composerDraftStore";
import { ThreadProviderIcon } from "./ThreadProviderIcon";

describe("thread provider identity", () => {
  it.each(["codex", "claudeAgent", "opencode", "cursor"] as const)(
    "labels saved %s threads",
    async (provider) => {
      const screen = await render(
        <ThreadProviderIcon threadId={ThreadId.makeUnsafe("saved")} provider={provider} />,
      );
      await expect
        .element(
          page.getByRole("img", {
            name:
              provider === "opencode"
                ? "OpenCode"
                : provider === "claudeAgent"
                  ? "Claude Code"
                  : PROVIDER_DISPLAY_NAMES[provider],
            exact: true,
          }),
        )
        .toBeInTheDocument();
      await screen.unmount();
    },
  );
  it("updates drafts immediately and prefers the active session after handoff", async () => {
    const id = ThreadId.makeUnsafe("provider-draft");
    const store = useComposerDraftStore.getState();
    store.setModelSelection(id, { provider: "claudeAgent", model: "claude-fable-5-1" });
    const screen = await render(<ThreadProviderIcon threadId={id} provider="codex" isDraft />);
    await expect
      .element(page.getByRole("img", { name: "Claude Code", exact: true }))
      .toBeInTheDocument();
    store.setModelSelection(id, { provider: "cursor", model: "auto" });
    await expect
      .element(page.getByRole("img", { name: "Cursor", exact: true }))
      .toBeInTheDocument();
    await screen.rerender(
      <ThreadProviderIcon threadId={id} provider="codex" sessionProvider="opencode" />,
    );
    await expect
      .element(page.getByRole("img", { name: "OpenCode", exact: true }))
      .toBeInTheDocument();
    await screen.unmount();
    store.clearDraftThread(id);
  });
});
