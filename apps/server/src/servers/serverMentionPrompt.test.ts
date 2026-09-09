import { ServerId, type ServerRecord } from "@synara/contracts";
import { Effect, Option } from "effect";
import { describe, expect, it } from "vitest";

import {
  appendSelectedServersBlock,
  buildSelectedServersPromptBlock,
  formatUptime,
  resolveServerMentions,
} from "./serverMentionPrompt";

const server = (overrides: Partial<ServerRecord> = {}): ServerRecord => ({
  id: ServerId.makeUnsafe("srv-1"),
  name: "web-1",
  host: "edge.example.test",
  port: 2222,
  username: "deploy",
  auth: { type: "agent" },
  tags: ["prod", "hk"],
  permissionTier: "approve-each",
  notes: "",
  source: "manual",
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
});

describe("formatUptime", () => {
  it("renders days, hours, and minutes at the right granularity", () => {
    expect(formatUptime(93_600)).toBe("1d 2h");
    expect(formatUptime(11_100)).toBe("3h 5m");
    expect(formatUptime(720)).toBe("12m");
    expect(formatUptime(0)).toBe("0m");
  });
});

describe("buildSelectedServersPromptBlock", () => {
  it("renders the helper instructions and one line per server", () => {
    const block = buildSelectedServersPromptBlock([
      server({
        notes: "Primary\nweb  node",
        lastStats: {
          collectedAt: 1,
          os: "Ubuntu 24.04.1 LTS",
          kernel: "Linux 6.8.0-45-generic",
          uptimeSeconds: 93_600,
        },
      }),
      server({
        id: ServerId.makeUnsafe("srv-2"),
        name: "db",
        port: 22,
        tags: [],
        permissionTier: "read-only",
      }),
    ]);
    expect(block).toBe(
      [
        "<selected_servers>",
        "The user attached these registered SSH servers to this turn. To run a command on one, call the djl-ssh helper that is already on PATH, one command per call, never interactive programs:",
        '  djl-ssh "<server name>" <command>',
        'Examples: djl-ssh "web-1" df -h ; djl-ssh "web-1" systemctl status nginx',
        "Output and the remote exit code are returned. Do not use plain ssh, scp, or store credentials; DJL handles authentication.",
        '- name: "web-1", address: deploy@edge.example.test:2222, permission: approve-each (the user approves every command before it runs; explain what a command does before running it), tags: prod, hk, system: Ubuntu 24.04.1 LTS, kernel: Linux 6.8.0-45-generic, uptime: 1d 2h, notes: Primary web node',
        '- name: "db", address: deploy@edge.example.test:22, permission: read-only (only inspection commands are allowed; anything that changes the server is refused)',
        "</selected_servers>",
      ].join("\n"),
    );
  });

  it("describes the full tier", () => {
    const block = buildSelectedServersPromptBlock([server({ permissionTier: "full" })]);
    expect(block).toContain(
      "permission: full (commands run without asking; prefer safe, reversible commands and state clearly what you changed)",
    );
  });
});

describe("resolveServerMentions", () => {
  const registry = new Map<string, ServerRecord>([["srv-1", server()]]);
  const lookup = (id: string) => Effect.succeed(Option.fromUndefinedOr(registry.get(id)));

  it("resolves ssh:// mentions and drops them from the remaining list", async () => {
    const fileMention = { name: "README.md", path: "/tmp/project/README.md" };
    const result = await Effect.runPromise(
      resolveServerMentions(
        [
          fileMention,
          { name: "web-1", path: "ssh://srv-1" },
          { name: "gone", path: "ssh://srv-missing" },
          { name: "web-1", path: "ssh://srv-1" },
        ],
        lookup,
      ),
    );
    expect(result.servers.map((entry) => entry.id)).toEqual(["srv-1"]);
    expect(result.remainingMentions).toEqual([fileMention]);
  });

  it("returns every mention untouched when none is a server", async () => {
    const mentions = [{ name: "a.ts", path: "/tmp/a.ts" }];
    const result = await Effect.runPromise(resolveServerMentions(mentions, lookup));
    expect(result).toEqual({ servers: [], remainingMentions: mentions });
  });
});

describe("appendSelectedServersBlock", () => {
  it("leaves text alone without servers", () => {
    expect(appendSelectedServersBlock("hello", [])).toBe("hello");
    expect(appendSelectedServersBlock(undefined, [])).toBeUndefined();
  });

  it("appends the block after a blank line, or returns the block alone", () => {
    const block = buildSelectedServersPromptBlock([server()]);
    expect(appendSelectedServersBlock("check disk", [server()])).toBe(`check disk\n\n${block}`);
    expect(appendSelectedServersBlock(undefined, [server()])).toBe(block);
  });
});
