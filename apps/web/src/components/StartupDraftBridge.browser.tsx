import { ThreadId, type ModelSelection } from "@synara/contracts";
import { StrictMode, useRef, useState } from "react";
import { afterEach, expect, it } from "vitest";
import { page } from "vitest/browser";
import { cleanup, render } from "vitest-browser-react";
import { ComposerPromptEditor, type ComposerPromptEditorHandle } from "./ComposerPromptEditor";
import { useComposerDraftStore } from "../composerDraftStore";
import { StartupStorage } from "../startup/storage";
import { StartupSession, getStartupSession, setStartupSession } from "../startup/session";
import { mountStartupShell } from "../startup/shell";
import { useStartupDraftBridge } from "../startup/useStartupDraftBridge";

const model: ModelSelection = { provider: "codex", model: "gpt-5.3-codex" };
const initialDrafts = useComposerDraftStore.getState();
const sends: string[] = [];
function start() {
  const storage = new StartupStorage("browser-test", localStorage);
  const session = new StartupSession(storage, "home", null);
  session.setModel(model);
  setStartupSession(session);
  session.attachShell(
    mountStartupShell({
      draft: session.draft,
      snapshot: null,
      locale: "en",
      editable: true,
      onEdit: (text) => session.edit(text),
      onSend: () => {
        session.requestSend();
      },
      onCancelSend: () => session.cancelSend(),
      onNavigate: () => {},
      onRetry: () => {},
    }),
  );
  return session;
}
function FullComposer({
  active,
  canSend = false,
  threadOverride,
}: {
  active: boolean;
  canSend?: boolean;
  threadOverride?: ThreadId;
}) {
  const session = getStartupSession()!;
  const threadId =
    threadOverride ?? ThreadId.makeUnsafe(session.draft.threadId ?? session.draft.id);
  const prompt = useComposerDraftStore((state) => state.draftsByThreadId[threadId]?.prompt ?? "");
  const [cursor, setCursor] = useState(0);
  const editor = useRef<ComposerPromptEditorHandle>(null);
  const send = useRef(async () => {
    const identity = session.identityFor(
      threadId,
      useComposerDraftStore.getState().draftsByThreadId[threadId]?.prompt ?? "",
      model,
    );
    sends.push(identity!.commandId);
    useComposerDraftStore.getState().setPrompt(threadId, "");
    return true;
  });
  useStartupDraftBridge({
    threadId,
    surface: "home",
    prompt,
    model,
    active,
    canSend,
    editor,
    send,
    locale: "en",
  });
  return (
    <div
      id="root"
      ref={(node) => {
        if (node) node.inert = session.previewActive;
      }}
    >
      <ComposerPromptEditor
        ref={editor}
        value={prompt}
        cursor={cursor}
        terminalContexts={[]}
        disabled={false}
        placeholder="Full editor"
        onRemoveTerminalContext={() => {}}
        onPaste={() => {}}
        onChange={(text, nextCursor) => {
          useComposerDraftStore.getState().setPrompt(threadId, text);
          setCursor(nextCursor);
        }}
      />
    </div>
  );
}

afterEach(async () => {
  await cleanup();
  getStartupSession()?.finishPreview();
  setStartupSession(null);
  useComposerDraftStore.setState(initialDrafts, true);
  for (const key of Object.keys(localStorage))
    if (key.startsWith("synara:startup:v1:browser-test:")) localStorage.removeItem(key);
  sends.length = 0;
});

it("preserves typed text, profile backup and selection when the full editor takes over", async () => {
  const session = start();
  const screen = await render(<FullComposer active={false} />);
  await page
    .getByRole("textbox", { name: "Ask anything, or describe a task…" })
    .fill("Draft 中文 text");
  const textarea = document.querySelector<HTMLTextAreaElement>("[data-startup-draft]")!;
  textarea.focus();
  textarea.setSelectionRange(6, 8);
  expect(session.isFocused()).toBe(true);
  expect(session.storage.readDraft("home")?.text).toBe("Draft 中文 text");
  await screen.rerender(<FullComposer active />);
  await expect.poll(() => session.previewActive).toBe(false);
  await expect.element(page.getByTestId("composer-editor")).toHaveTextContent("Draft 中文 text");
  await expect.poll(() => window.getSelection()?.toString()).toBe("中文");
});

it("waits for IME composition and transfers the final revision", async () => {
  const session = start();
  const screen = await render(<FullComposer active={false} />);
  const textarea = document.querySelector<HTMLTextAreaElement>("[data-startup-draft]")!;
  textarea.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
  await screen.rerender(<FullComposer active />);
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  expect(session.previewActive).toBe(true);
  textarea.value = "最终文字";
  textarea.dispatchEvent(new InputEvent("input", { bubbles: true }));
  textarea.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
  await expect.poll(() => session.previewActive).toBe(false);
  await expect.element(page.getByTestId("composer-editor")).toHaveTextContent("最终文字");
});

it("dispatches one pending intent after readiness under StrictMode", async () => {
  const session = start();
  session.edit("hello");
  session.requestSend();
  const id = session.draft.id;
  const screen = await render(
    <StrictMode>
      <FullComposer active />
    </StrictMode>,
  );
  await expect.poll(() => session.previewActive).toBe(false);
  expect(sends).toEqual([]);
  await screen.rerender(
    <StrictMode>
      <FullComposer active canSend />
    </StrictMode>,
  );
  await expect.poll(() => sends).toEqual([`startup-${id}`]);
  expect(session.storage.readDraft("home")).toBeNull();
});

it("preserves a newer same-owner composer when recovering an uncertain send", async () => {
  const session = start();
  session.edit("older unconfirmed send");
  session.requestSend();
  const threadId = ThreadId.makeUnsafe(session.draft.id);
  session.bindThread(threadId);
  session.claimSend(threadId);
  session.sendFinished(session.draft.id, false);
  session.editedDuringPreview = false;
  session.navigate(`/${threadId}`);
  useComposerDraftStore.getState().setPrompt(threadId, "newer saved draft");
  await render(<FullComposer active />);
  await expect.poll(() => session.previewActive).toBe(false);
  await expect.element(page.getByTestId("composer-editor")).toHaveTextContent("newer saved draft");
  expect(session.storage.readDraft("home")?.text).toBe("older unconfirmed send");
  expect(sends).toEqual([]);
});

it("restores an uncertain draft on a direct thread reload without sending again", async () => {
  const session = start();
  session.edit("uncertain saved text");
  session.requestSend();
  session.bindThread(session.draft.id);
  session.claimSend(session.draft.id);
  const recovered = new StartupSession(session.storage, "home", null);
  session.finishPreview();
  setStartupSession(recovered);
  recovered.navigate(`/${recovered.draft.threadId}`);
  recovered.attachShell(
    mountStartupShell({
      draft: recovered.draft,
      snapshot: null,
      locale: "en",
      editable: true,
      onEdit: (text) => recovered.edit(text),
      onSend: () => {},
      onCancelSend: () => {},
      onNavigate: () => {},
      onRetry: () => {},
    }),
  );
  await render(<FullComposer active canSend />);
  await expect.poll(() => recovered.previewActive).toBe(false);
  await expect
    .element(page.getByTestId("composer-editor"))
    .toHaveTextContent("uncertain saved text");
  expect(sends).toEqual([]);
});

it("does not overwrite an unbound startup draft after cached-thread navigation", async () => {
  const session = start();
  session.edit("keep this unbound text");
  session.navigate("/cached-thread");
  session.finishPreview();
  await render(<FullComposer active threadOverride={ThreadId.makeUnsafe("cached-thread")} />);
  expect(session.storage.readDraft("home")?.text).toBe("keep this unbound text");
  expect(session.draft.threadId).toBeNull();
});
