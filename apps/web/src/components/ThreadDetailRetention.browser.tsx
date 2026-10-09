import { ThreadId, MessageId } from "@synara/contracts";
import { StrictMode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render } from "vitest-browser-react";
import { useStore } from "../store";
import {
  resetRetainedThreadDetailSubscriptionsForTests,
  retainThreadDetailSubscription,
  useRetainVisibleThreadDetails,
} from "../threadDetailSubscriptionRetention";

const threadId = ThreadId.makeUnsafe("visible-split-pane");
const messageId = MessageId.makeUnsafe("visible-message");
const visibleIds = [threadId];
const initialState = useStore.getState();

function VisiblePane() {
  useRetainVisibleThreadDetails(visibleIds);
  const text = useStore((state) => state.messageByThreadId?.[threadId]?.[messageId]?.text);
  return <div>{text}</div>;
}

afterEach(async () => {
  await cleanup();
  resetRetainedThreadDetailSubscriptionsForTests();
  useStore.setState(initialState, true);
  vi.useRealTimers();
});

it("keeps a visible split pane's history after sidebar prewarm expires, then frees it on leaving", async () => {
  vi.useFakeTimers();
  useStore.setState({
    messageByThreadId: {
      [threadId]: {
        [messageId]: {
          id: messageId,
          role: "assistant",
          text: "Visible history",
          createdAt: "2026-01-01T00:00:00.000Z",
          streaming: false,
        },
      },
    },
  });
  const releasePrewarm = retainThreadDetailSubscription(threadId);
  const screen = await render(
    <StrictMode>
      <VisiblePane />
    </StrictMode>,
  );
  releasePrewarm();
  await vi.advanceTimersByTimeAsync(16 * 60 * 1000);
  expect(useStore.getState().messageByThreadId?.[threadId]?.[messageId]?.text).toBe(
    "Visible history",
  );
  await screen.unmount();
  await vi.advanceTimersByTimeAsync(15 * 60 * 1000);
  expect(useStore.getState().messageByThreadId?.[threadId]).toBeUndefined();
});

it("keeps visible history across effect replay when the cache is over capacity", async () => {
  const releases = Array.from({ length: 40 }, (_, index) =>
    retainThreadDetailSubscription(ThreadId.makeUnsafe(`active-${index}`)),
  );
  useStore.setState({
    messageByThreadId: {
      [threadId]: {
        [messageId]: {
          id: messageId,
          role: "assistant",
          text: "Visible history",
          createdAt: "2026-01-01T00:00:00.000Z",
          streaming: false,
        },
      },
    },
  });
  try {
    await render(
      <StrictMode>
        <VisiblePane />
      </StrictMode>,
    );
    expect(useStore.getState().messageByThreadId?.[threadId]?.[messageId]?.text).toBe(
      "Visible history",
    );
  } finally {
    for (const release of releases) release();
  }
});
