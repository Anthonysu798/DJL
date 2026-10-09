import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { ServerCreateInput, ServerRecord, serverReference } from "./servers";

describe("server contracts", () => {
  it("decodes a minimal create input with defaults", () => {
    const decoded = Schema.decodeUnknownSync(ServerCreateInput)({
      name: "hk-1",
      host: "203.0.113.10",
      username: "root",
      auth: { type: "agent" },
    });
    expect(decoded.port).toBe(22);
    expect(decoded.tags).toEqual([]);
    expect(decoded.permissionTier).toBe("read-only");
    expect(decoded.notes).toBe("");
    expect(decoded.source).toBe("manual");
  });

  it("rejects option-looking host and username", () => {
    expect(() =>
      Schema.decodeUnknownSync(ServerCreateInput)({
        name: "x",
        host: "-oProxyCommand=evil",
        username: "root",
        auth: { type: "agent" },
      }),
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(ServerCreateInput)({
        name: "x",
        host: "h",
        username: "-l",
        auth: { type: "agent" },
      }),
    ).toThrow();
  });

  it("rejects tags with spaces and accepts unicode tags", () => {
    const ok = Schema.decodeUnknownSync(ServerCreateInput)({
      name: "x",
      host: "h",
      username: "u",
      auth: { type: "agent" },
      tags: ["生产", "web_1"],
    });
    expect(ok.tags).toEqual(["生产", "web_1"]);
    expect(() =>
      Schema.decodeUnknownSync(ServerCreateInput)({
        name: "x",
        host: "h",
        username: "u",
        auth: { type: "agent" },
        tags: ["has space"],
      }),
    ).toThrow();
  });

  it("builds the ssh:// reference from a record id", () => {
    const record = Schema.decodeUnknownSync(ServerRecord)({
      id: "abc",
      name: "n",
      host: "h",
      port: 22,
      username: "u",
      auth: { type: "password" },
      tags: [],
      permissionTier: "full",
      notes: "",
      source: "manual",
      createdAt: 1,
      updatedAt: 1,
    });
    expect(serverReference(record)).toEqual({ name: "n", path: "ssh://abc" });
  });
});
