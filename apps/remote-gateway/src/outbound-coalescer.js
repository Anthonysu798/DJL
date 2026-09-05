// FILE: outbound-coalescer.js
// Purpose: Batches phone-bound notifications into one relay frame per short window and merges adjacent deltas.
// Layer: CLI helper
// Exports: createOutboundCoalescer, DEFAULT_COALESCE_WINDOW_MS
// Depends on: nothing

const DEFAULT_COALESCE_WINDOW_MS = 40;
const DELTA_METHOD = "item/agentMessage/delta";

// Streaming produces dozens of tiny notifications a second. The relay budgets
// frames, not bytes, so a 40ms window turns a burst into one encrypted frame
// while responses and approval prompts keep their exact position in the order.
function createOutboundCoalescer({
  windowMs = DEFAULT_COALESCE_WINDOW_MS,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  flush,
} = {}) {
  if (typeof flush !== "function") {
    throw new Error("outbound coalescer requires a flush callback");
  }
  const pending = [];
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
    const last = pending[pending.length - 1];
    if (last && canMergeDeltas(last, parsed)) {
      last.params = {
        ...last.params,
        delta: `${last.params.delta}${parsed.params.delta}`,
      };
    } else {
      pending.push(parsed);
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
    flush(JSON.stringify(batch.length === 1 ? batch[0] : batch));
  }

  return {
    push,
    flushNow: flushPending,
    stop: flushPending,
  };
}

function canMergeDeltas(previous, next) {
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

module.exports = { createOutboundCoalescer, DEFAULT_COALESCE_WINDOW_MS };
