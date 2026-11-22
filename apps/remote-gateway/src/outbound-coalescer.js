// FILE: outbound-coalescer.js
// Purpose: Batches phone-bound notifications into one relay frame per short window and merges adjacent deltas.
// Layer: CLI helper
// Exports: createOutboundCoalescer, DEFAULT_COALESCE_WINDOW_MS
// Depends on: nothing

const DEFAULT_COALESCE_WINDOW_MS = 40;
// Relay frames are capped at 1 MiB; keep batches far below that.
const DEFAULT_MAX_BATCH_MESSAGES = 64;
// Terminal output chunks are large; cap batch bytes so a burst of them never
// approaches the relay frame limit.
const DEFAULT_MAX_BATCH_BYTES = 262_144;
const DELTA_METHOD = "item/agentMessage/delta";
const GROUP_DRAFT_METHOD = "djl/groups/draft";

// Streaming produces dozens of tiny notifications a second. The relay budgets
// frames, not bytes, so a 40ms window turns a burst into one encrypted frame
// while responses and approval prompts keep their exact position in the order.
function createOutboundCoalescer({
  windowMs = DEFAULT_COALESCE_WINDOW_MS,
  maxBatchMessages = DEFAULT_MAX_BATCH_MESSAGES,
  maxBatchBytes = DEFAULT_MAX_BATCH_BYTES,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  flush,
} = {}) {
  if (typeof flush !== "function") {
    throw new Error("outbound coalescer requires a flush callback");
  }
  const pending = [];
  let pendingBytes = 0;
  let timer = null;

  function push(payloadText) {
    const parsed = safeParse(payloadText);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      flushPending();
      flush(payloadText);
      return;
    }
    const isNotification = typeof parsed.method === "string" && parsed.id == null;
    if (!isNotification) {
      flushPending();
      flush(payloadText);
      return;
    }
    if (pending.length > 0 && pendingBytes + payloadText.length > maxBatchBytes) {
      flushPending();
    }
    pendingBytes += payloadText.length;
    const last = pending[pending.length - 1];
    if (last && canMergeDeltas(last, parsed)) {
      last.params = {
        ...last.params,
        delta: `${last.params.delta}${parsed.params.delta}`,
      };
    } else {
      pending.push(parsed);
    }
    if (pending.length >= maxBatchMessages) {
      flushPending();
      return;
    }
    if (timer == null) {
      timer = setTimeoutFn(() => {
        timer = null;
        flushPending();
      }, windowMs);
      timer?.unref?.();
    }
  }

  function flushPending() {
    if (timer != null) {
      clearTimeoutFn(timer);
      timer = null;
    }
    if (pending.length === 0) return;
    const batch = pending.splice(0, pending.length);
    pendingBytes = 0;
    flush(JSON.stringify(batch.length === 1 ? batch[0] : batch));
  }

  return {
    push,
    flushNow: flushPending,
    stop: flushPending,
  };
}

function canMergeDeltas(previous, next) {
  // A draft that restarts replaces the member's text, so it starts a new run.
  if (previous.method === GROUP_DRAFT_METHOD && next.method === GROUP_DRAFT_METHOD) {
    return (
      typeof previous.params?.delta === "string" &&
      typeof next.params?.delta === "string" &&
      next.params.restart !== true &&
      previous.params.groupId === next.params.groupId &&
      previous.params.memberId === next.params.memberId
    );
  }
  return (
    previous.method === DELTA_METHOD &&
    next.method === DELTA_METHOD &&
    typeof previous.params?.delta === "string" &&
    typeof next.params?.delta === "string" &&
    previous.params.threadId === next.params.threadId &&
    previous.params.itemId === next.params.itemId &&
    previous.params.turnId === next.params.turnId
  );
}

function safeParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

module.exports = {
  createOutboundCoalescer,
  DEFAULT_COALESCE_WINDOW_MS,
  DEFAULT_MAX_BATCH_MESSAGES,
  DEFAULT_MAX_BATCH_BYTES,
};
