import {
  GROUP_GUEST_AGENT_PROMPT_LIMIT,
  GROUP_GUEST_AGENT_STALE_MS,
  type GroupGuestAgentTurnEvent,
} from "@djl/contracts";
import { describe, expect, it } from "vitest";

import {
  GUEST_AGENT_LEFT,
  GUEST_AGENT_OFFLINE,
  GUEST_AGENT_TOO_LONG,
  makeGuestAgentHub,
} from "./guestAgentHub";

const setup = () => {
  let clock = 1_000;
  let ids = 0;
  const presence: string[] = [];
  const hub = makeGuestAgentHub({
    now: () => clock,
    newId: () => `turn-${++ids}`,
    timer: false,
    onPresence: (guestId, online) => presence.push(`${guestId}:${online ? "on" : "off"}`),
  });
  const sent: GroupGuestAgentTurnEvent[] = [];
  const connect = (guestId = "guest0001") => {
    hub.seen(guestId, "session-1");
    return hub.listen(guestId, (event) => sent.push(event));
  };
  return { hub, sent, presence, connect, advance: (ms: number) => (clock += ms) };
};

describe("guest agent hub", () => {
  it("sends a turn to the guest's computer and returns its answer", async () => {
    const { hub, sent, connect } = setup();
    connect();
    const drafts: string[] = [];
    const turn = hub.ask("guest0001", "hello", (delta, restart) =>
      drafts.push(`${restart ? "!" : ""}${delta}`),
    );
    expect(sent).toEqual([{ type: "turn", turnId: "turn-1", prompt: "hello" }]);
    hub.draft("guest0001", "turn-1", "Hi", true);
    hub.draft("guest0001", "turn-1", " there", false);
    hub.reply("guest0001", "turn-1", "ok", "Hi there");
    expect(await turn.reply).toEqual({ status: "ok", text: "Hi there" });
    expect(drafts).toEqual(["!Hi", " there"]);
  });

  it("fails at once when the agent is not connected", async () => {
    const { hub, sent } = setup();
    expect(hub.session("guest0001")).toBeNull();
    expect(await hub.ask("guest0001", "hello").reply).toEqual({
      status: "failed",
      error: GUEST_AGENT_OFFLINE,
    });
    // Announced, but nobody listens for its turns yet.
    hub.seen("guest0001", "session-1");
    expect(hub.session("guest0001")).toBeNull();
    expect(sent).toEqual([]);
  });

  it("treats an agent that stopped saying it is there as offline, and fails its turn", async () => {
    const { hub, connect, advance } = setup();
    connect();
    const turn = hub.ask("guest0001", "hello");
    advance(GROUP_GUEST_AGENT_STALE_MS - 1);
    hub.sweep();
    expect(hub.session("guest0001")).toBe("session-1");
    advance(2);
    expect(hub.session("guest0001")).toBeNull();
    hub.sweep();
    expect(await turn.reply).toEqual({ status: "failed", error: GUEST_AGENT_LEFT });
  });

  it("reports the new session after the agent starts over", () => {
    const { hub, connect } = setup();
    connect();
    hub.seen("guest0001", "session-2");
    expect(hub.session("guest0001")).toBe("session-2");
  });

  it("fails the open turn when the gateway stops listening", async () => {
    const { hub, connect } = setup();
    const stop = connect();
    const turn = hub.ask("guest0001", "hello");
    stop();
    expect(await turn.reply).toEqual({ status: "failed", error: GUEST_AGENT_LEFT });
  });

  it("ignores an answer from another guest, or for a turn that is over", async () => {
    const { hub, connect } = setup();
    connect();
    connect("guest0002");
    const turn = hub.ask("guest0001", "hello");
    hub.reply("guest0002", "turn-1", "ok", "not mine to answer");
    hub.reply("guest0001", "turn-1", "failed", "  ");
    hub.reply("guest0001", "turn-1", "ok", "too late");
    expect(await turn.reply).toEqual({
      status: "failed",
      error: "The visiting agent could not answer.",
    });
  });

  it("tells the guest's computer to stop when the turn is cancelled", async () => {
    const { hub, sent, connect } = setup();
    connect();
    const turn = hub.ask("guest0001", "hello");
    turn.cancel();
    expect(sent.at(-1)).toEqual({ type: "cancel", turnId: "turn-1" });
    expect((await turn.reply).status).toBe("failed");
  });

  it("forgets a removed guest, and tells their computer", async () => {
    const { hub, sent, connect } = setup();
    connect();
    const turn = hub.ask("guest0001", "hello");
    hub.forget("guest0001");
    expect(sent.at(-1)).toEqual({ type: "removed" });
    expect(await turn.reply).toEqual({ status: "failed", error: GUEST_AGENT_OFFLINE });
    expect(hub.session("guest0001")).toBeNull();
  });

  it("refuses a prompt the relay could not carry instead of waiting for ever", async () => {
    const { hub, sent, connect } = setup();
    connect();
    const turn = hub.ask("guest0001", "x".repeat(GROUP_GUEST_AGENT_PROMPT_LIMIT + 1));
    expect(await turn.reply).toEqual({ status: "failed", error: GUEST_AGENT_TOO_LONG });
    expect(sent).toEqual([]);
  });

  it("reports each change of presence once", () => {
    const { hub, presence, connect, advance } = setup();
    const stop = connect();
    hub.seen("guest0001", "session-1");
    expect(presence).toEqual(["guest0001:on"]);
    expect(hub.online()).toEqual(["guest0001"]);
    advance(GROUP_GUEST_AGENT_STALE_MS + 1);
    // Quiet for too long: offline even before the next sweep says so.
    expect(hub.online()).toEqual([]);
    hub.sweep();
    hub.sweep();
    expect(presence).toEqual(["guest0001:on", "guest0001:off"]);
    hub.seen("guest0001", "session-1");
    stop();
    expect(presence).toEqual(["guest0001:on", "guest0001:off", "guest0001:on", "guest0001:off"]);
  });
});
