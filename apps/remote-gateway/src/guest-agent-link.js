// FILE: guest-agent-link.js
// Purpose: Lends one of this computer's agents to another person's Multi agents group. It
//          connects to that person's guest gateway like a phone would (guest-link-client), tells
//          it which agent joined, and answers each turn the group sends by asking this
//          computer's own DJL backend to run the agent. Only text travels back.
// Layer: CLI helper
// Exports: createGuestAgentLink, startGuestAgentLink
// Depends on: ./guest-link-client, ./electron-backend-rpc

const { createGuestLinkClient } = require("./guest-link-client");
const { createElectronBackendRpcClient } = require("./electron-backend-rpc");

const LENT = {
  open: "groups.lentAgentOpen",
  close: "groups.lentAgentClose",
  ask: "groups.lentAgentAsk",
};
// Must match GROUP_GUEST_AGENT_HEARTBEAT_MS in packages/contracts/src/groups.ts: the group
// treats an agent it has not heard from for 75 seconds as offline.
const HEARTBEAT_MS = 30_000;
const DRAFT_FLUSH_MS = 200;
const RESTARTED_MESSAGE = "This agent had just restarted. Ask it again.";

/**
 * `backend` is this computer's own DJL backend (`request`, `subscribe`). `onStatus` receives
 * `{ state, hostName, groupName, handle, busy, error? }`, where state is "connecting",
 * "connected", "offline" (retrying by itself) or "refused" (the invite is gone; no retry).
 */
function createGuestAgentLink({
  linkId,
  provider,
  model = null,
  stateDir,
  relayUrl,
  code,
  backend,
  onStatus = () => {},
  createClient = createGuestLinkClient,
  heartbeatMs = HEARTBEAT_MS,
  draftFlushMs = DRAFT_FLUSH_MS,
}) {
  let status = { state: "connecting", hostName: null, groupName: null, handle: null, busy: false };
  let heartbeat = null;
  let sequence = 0;
  // The session the group was last told about; a turn for any other one lacks its briefing.
  let announcedSession = null;
  let stopped = false;
  const turns = new Map();

  const report = (patch) => {
    status = { ...status, ...patch, busy: turns.size > 0 };
    onStatus(status);
  };

  const client = createClient({
    stateDir,
    relayUrl,
    ...(code ? { code } : {}),
    onMessage: handleMessage,
    onStatus: handleTransport,
  });

  function handleTransport(transport) {
    if (stopped) return;
    if (transport.state === "connected") {
      // Not "connected" for the user yet: the group still has to accept the agent.
      report({ hostName: transport.hostName ?? status.hostName });
      void announce();
      clearInterval(heartbeat);
      heartbeat = setInterval(() => void announce(), heartbeatMs);
      heartbeat.unref?.();
      return;
    }
    clearInterval(heartbeat);
    heartbeat = null;
    announcedSession = null;
    cancelTurns();
    const { error: _error, ...rest } = status;
    report({
      ...rest,
      state: transport.state,
      hostName: transport.hostName ?? status.hostName,
      ...(transport.error ? { error: transport.error } : {}),
    });
  }

  // Says which agent is here. Repeated as a heartbeat, and it carries the agent's current
  // session, so the group briefs the agent again after its CLI was closed.
  async function announce() {
    try {
      const { sessionId } = await backend.request(LENT.open, { linkId });
      if (stopped) return;
      announcedSession = sessionId;
      client.send({
        id: `join-${++sequence}`,
        method: "djl/groups/agent/join",
        params: { provider, model, sessionId },
      });
    } catch {
      // This computer's own backend is restarting; the next heartbeat tries again.
    }
  }

  function handleMessage(message) {
    if (!message || typeof message !== "object") return;
    if (typeof message.id === "string" && message.id.startsWith("join-")) {
      if (message.error) {
        // The owner removed the invite or changed what this guest may do.
        report({ state: "refused", error: String(message.error.message ?? "Not allowed.") });
        return;
      }
      const { error: _error, ...rest } = status;
      report({
        ...rest,
        state: "connected",
        groupName: message.result?.groupName || status.groupName,
        handle: message.result?.handle || status.handle,
      });
      return;
    }
    const params = message.params && typeof message.params === "object" ? message.params : {};
    if (message.method === "djl/groups/agent/turn") void answer(params);
    else if (message.method === "djl/groups/agent/cancel") cancelTurn(String(params.turnId ?? ""));
    else if (message.method === "djl/groups/agent/removed") removed();
  }

  // The owner took the invite back. Without this the link would look "offline" for ever.
  function removed() {
    stopped = true;
    clearInterval(heartbeat);
    cancelTurns();
    client.stop();
    report({ state: "refused", error: "The group's owner removed this agent." });
  }

  const send = (method, params) => client.send({ id: `m-${++sequence}`, method, params });
  const reply = (turnId, replyStatus, text) =>
    send("djl/groups/agent/reply", { turnId, status: replyStatus, text });

  async function answer({ turnId, prompt }) {
    if (typeof turnId !== "string" || typeof prompt !== "string" || turns.has(turnId)) return;
    turns.set(turnId, () => {});
    report({});
    let sessionId;
    try {
      ({ sessionId } = await backend.request(LENT.open, { linkId }));
    } catch {
      finish(turnId);
      reply(turnId, "failed", "The agent's computer is not ready. Try again in a moment.");
      return;
    }
    if (!turns.has(turnId)) return; // cancelled while opening
    if (sessionId !== announcedSession) {
      // Its CLI was closed while idle: this turn was written for the old session.
      finish(turnId);
      reply(turnId, "failed", RESTARTED_MESSAGE);
      void announce();
      return;
    }
    let pending = "";
    let restart = false;
    let flushTimer = null;
    const flush = () => {
      flushTimer = null;
      if (!pending && !restart) return;
      send("djl/groups/agent/draft", { turnId, delta: pending, restart });
      pending = "";
      restart = false;
    };
    let finished = false;
    // Set once the stream is open; a stream that ends at once has nothing to stop yet.
    let stopStream = null;
    const done = (replyStatus, text) => {
      if (finished || !turns.has(turnId)) return;
      finished = true;
      clearTimeout(flushTimer);
      stopStream?.();
      finish(turnId);
      reply(turnId, replyStatus, text);
    };
    const unsubscribe = backend.subscribe(
      LENT.ask,
      { linkId, sessionId, provider, model, prompt },
      {
        onChunk(values) {
          for (const value of values) {
            if (value?.type === "draft") {
              if (value.restart) {
                pending = "";
                restart = true;
              }
              pending += String(value.delta ?? "");
              flushTimer ??= setTimeout(flush, draftFlushMs);
            } else if (value?.type === "done") {
              done(value.status === "ok" ? "ok" : "failed", String(value.text ?? ""));
            }
          }
        },
        onEnd: () => done("failed", "The agent stopped without an answer."),
        onError: () => done("failed", "The agent could not answer."),
      },
    );
    if (finished) return unsubscribe();
    stopStream = unsubscribe;
    // Cancelling ends the stream, which stops the agent on this computer.
    turns.set(turnId, () => {
      finished = true;
      clearTimeout(flushTimer);
      unsubscribe();
    });
  }

  function finish(turnId) {
    turns.delete(turnId);
    report({});
  }

  function cancelTurn(turnId) {
    const stop = turns.get(turnId);
    if (!stop) return;
    stop();
    finish(turnId);
  }

  function cancelTurns() {
    for (const turnId of Array.from(turns.keys())) cancelTurn(turnId);
  }

  return {
    start() {
      onStatus(status);
      client.start();
    },
    stop() {
      stopped = true;
      clearInterval(heartbeat);
      cancelTurns();
      client.stop();
    },
    /** Leaves the group for good: forgets the host and closes the agent's session. */
    async leave() {
      stopped = true;
      clearInterval(heartbeat);
      cancelTurns();
      client.forget();
      await backend.request(LENT.close, { linkId }).catch(() => {});
    },
    status: () => status,
  };
}

/** The process entry: reads the link from the environment the desktop app set. */
function startGuestAgentLink({ env = process.env, onStatus } = {}) {
  const required = (name) => {
    const value = typeof env[name] === "string" ? env[name].trim() : "";
    if (!value) throw new Error(`${name} is required.`);
    return value;
  };
  const backend = createElectronBackendRpcClient({
    endpoint: required("DJL_ELECTRON_BACKEND_ENDPOINT"),
  });
  const link = createGuestAgentLink({
    linkId: required("DJL_AGENT_LINK_ID"),
    provider: required("DJL_AGENT_LINK_PROVIDER"),
    model: env.DJL_AGENT_LINK_MODEL?.trim() || null,
    stateDir: required("DJL_AGENT_LINK_STATE_DIR"),
    relayUrl: required("DJL_RELAY"),
    code: env.DJL_AGENT_LINK_CODE?.trim() || undefined,
    backend,
    onStatus,
  });
  link.start();
  return {
    stop() {
      link.stop();
      backend.shutdown?.();
    },
    async leave() {
      await link.leave();
      backend.shutdown?.();
    },
  };
}

module.exports = { createGuestAgentLink, startGuestAgentLink };
