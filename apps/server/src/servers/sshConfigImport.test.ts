import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect } from "effect";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { expandHomePath, parseSshConfig, readSshConfigHosts } from "./sshConfigImport";

describe("parseSshConfig", () => {
  it("collects concrete hosts and skips wildcards and negations", () => {
    const parsed = parseSshConfig(`
# comment
Include conf.d/*
Host *
  ServerAliveInterval 30
Host hk web-1 !bad
  HostName 203.0.113.10
  Port 2222
  User deploy
  IdentityFile ~/.ssh/id_hk
Host plain
Host staging.*
  HostName ignored
`);
    expect(parsed.includes).toEqual(["conf.d/*"]);
    expect(parsed.hosts).toEqual([
      {
        alias: "hk",
        hostName: "203.0.113.10",
        port: 2222,
        user: "deploy",
        identityFile: "~/.ssh/id_hk",
      },
      {
        alias: "web-1",
        hostName: "203.0.113.10",
        port: 2222,
        user: "deploy",
        identityFile: "~/.ssh/id_hk",
      },
      { alias: "plain", hostName: "plain", port: 22 },
    ]);
  });

  it("is case-insensitive on keywords and accepts key=value", () => {
    const parsed = parseSshConfig("host a\n  hostname=1.2.3.4\n  PORT 22\n");
    expect(parsed.hosts[0]).toEqual({ alias: "a", hostName: "1.2.3.4", port: 22 });
  });
});

describe("expandHomePath", () => {
  it("expands ~ only at the start", () => {
    expect(expandHomePath("~/.ssh/id", "/home/me")).toBe(path.join("/home/me", ".ssh/id"));
    expect(expandHomePath("/abs/~x", "/home/me")).toBe("/abs/~x");
  });
});

describe("readSshConfigHosts", () => {
  let home: string;
  beforeAll(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "djl-ssh-home-"));
    fs.mkdirSync(path.join(home, ".ssh", "conf.d"), { recursive: true });
    fs.writeFileSync(
      path.join(home, ".ssh", "config"),
      "Include conf.d/*.conf\nHost main\n  HostName 10.0.0.1\n",
    );
    fs.writeFileSync(
      path.join(home, ".ssh", "conf.d", "work.conf"),
      "Host work\n  HostName 10.0.0.2\n  User w\n",
    );
    fs.writeFileSync(path.join(home, ".ssh", "conf.d", "ignored.txt"), "Host nope\n");
  });
  afterAll(() => fs.rmSync(home, { recursive: true, force: true }));

  it("reads the main file and one level of includes", async () => {
    const result = await Effect.runPromise(
      readSshConfigHosts(home).pipe(Effect.provide(NodeServices.layer)),
    );
    expect(result.configPath).toBe(path.join(home, ".ssh", "config"));
    expect(result.hosts.map((h) => h.alias).toSorted()).toEqual(["main", "work"]);
  });

  it("returns no hosts when the config is missing", async () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "djl-ssh-empty-"));
    const result = await Effect.runPromise(
      readSshConfigHosts(empty).pipe(Effect.provide(NodeServices.layer)),
    );
    expect(result.hosts).toEqual([]);
    fs.rmSync(empty, { recursive: true, force: true });
  });
});
