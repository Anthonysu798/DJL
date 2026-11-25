import { describe, expect, it } from "vitest";

import {
  MAX_AGENT_LINKS,
  agentLinkEnv,
  agentLinkStateDir,
  initialAgentLink,
  normalizeInviteCode,
  parseAgentLinkRecords,
  planAgentLink,
  recordOf,
  reduceAgentLink,
} from "./agentLinks";

const record = {
  id: "link00000001",
  provider: "codex",
  model: "gpt-x",
  createdAt: 5,
  hostName: null,
  groupName: null,
  handle: null,
};

describe("saved links", () => {
  it("keeps well-formed links and drops the rest", () => {
    expect(
      parseAgentLinkRecords([
        { ...record, hostName: "Alice's Mac" },
        { ...record, id: "../../etc" },
        { ...record, id: "link00000002", provider: "group" },
        "nonsense",
      ]),
    ).toEqual([{ ...record, hostName: "Alice's Mac" }]);
    expect(parseAgentLinkRecords({})).toEqual([]);
  });

  it("refuses an id that could leave the links folder", () => {
    expect(() => agentLinkStateDir("/base", "../x")).toThrow();
    expect(agentLinkStateDir("/base", "link00000001")).toBe("/base/agent-links/link00000001");
  });
});

describe("lending an agent", () => {
  const plan = (request: unknown, existing = 0) =>
    planAgentLink({ request, existing, newId: () => "link00000009", now: 9 });

  it("accepts a code however it was typed", () => {
    expect(normalizeInviteCode(" ryv9-uhae 2c ")).toBe("RYV9UHAE2C");
    expect(normalizeInviteCode("RYV9UHAE2")).toBeNull();
    expect(normalizeInviteCode("RYV9UHAE1C")).toBeNull();
    expect(plan({ code: "ryv9-uhae2c", provider: "claudeAgent", model: " opus " })).toEqual({
      code: "RYV9UHAE2C",
      record: {
        ...record,
        id: "link00000009",
        provider: "claudeAgent",
        model: "opus",
        createdAt: 9,
      },
    });
  });

  it("says what is missing", () => {
    expect(plan({ code: "short", provider: "codex" })).toEqual({
      error: "Enter the 10-character invite code.",
    });
    expect(plan({ code: "RYV9UHAE2C", provider: "group" })).toEqual({
      error: "Choose an agent to lend.",
    });
    expect(plan({ code: "RYV9UHAE2C", provider: "codex" }, MAX_AGENT_LINKS)).toHaveProperty(
      "error",
    );
  });

  it("gives the link's process its code once, and never another link's", () => {
    const base = { PATH: "/bin", DJL_AGENT_LINK_CODE: "LEFTOVER00", DJL_AGENT_LINK_MODEL: "old" };
    const input = {
      base,
      record,
      baseDir: "/base",
      relayUrl: "wss://r/relay",
      backendWsUrl: "ws://b",
    };
    expect(agentLinkEnv({ ...input, code: "RYV9UHAE2C" })).toMatchObject({
      PATH: "/bin",
      DJL_AGENT_LINK_ID: "link00000001",
      DJL_AGENT_LINK_PROVIDER: "codex",
      DJL_AGENT_LINK_MODEL: "gpt-x",
      DJL_AGENT_LINK_CODE: "RYV9UHAE2C",
      DJL_AGENT_LINK_STATE_DIR: "/base/agent-links/link00000001",
      DJL_RELAY: "wss://r/relay",
      DJL_ELECTRON_BACKEND_ENDPOINT: "ws://b",
    });
    const later = agentLinkEnv({ ...input, record: { ...record, model: null }, code: null });
    expect(later.DJL_AGENT_LINK_CODE).toBeUndefined();
    expect(later.DJL_AGENT_LINK_MODEL).toBeUndefined();
  });
});

describe("a link's status", () => {
  it("follows the link's process and remembers where the agent went", () => {
    const link = initialAgentLink(record);
    expect(link).toMatchObject({ status: "connecting", busy: false, hostName: null });
    const connected = reduceAgentLink(link, {
      type: "status",
      status: {
        state: "connected",
        hostName: "Alice's Mac",
        groupName: "Launch team",
        handle: "Bo",
        busy: true,
      },
    });
    expect(connected).toMatchObject({
      status: "connected",
      hostName: "Alice's Mac",
      groupName: "Launch team",
      handle: "Bo",
      busy: true,
      message: null,
    });
    const offline = reduceAgentLink(connected, {
      type: "status",
      status: { state: "offline", error: "The other computer is asleep." },
    });
    // The names stay, so the row still says whose group it is.
    expect(offline).toMatchObject({
      status: "offline",
      groupName: "Launch team",
      busy: false,
      message: "The other computer is asleep.",
    });
    expect(recordOf(record, connected)).toEqual({
      ...record,
      hostName: "Alice's Mac",
      groupName: "Launch team",
      handle: "Bo",
    });
  });

  it("ignores messages it does not understand", () => {
    const link = initialAgentLink(record);
    expect(reduceAgentLink(link, { type: "status", status: { state: "exploded" } })).toBe(link);
    expect(reduceAgentLink(link, { type: "pairing" })).toBe(link);
    expect(reduceAgentLink(link, null)).toBe(link);
  });
});
