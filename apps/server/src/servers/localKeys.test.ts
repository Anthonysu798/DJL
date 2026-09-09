import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect } from "effect";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { listLocalPrivateKeys } from "./localKeys";

describe("listLocalPrivateKeys", () => {
  let home: string;
  beforeAll(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "djl-keys-home-"));
    const sshDir = path.join(home, ".ssh");
    fs.mkdirSync(sshDir);
    fs.writeFileSync(path.join(sshDir, "id_ed25519"), "-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n");
    fs.writeFileSync(path.join(sshDir, "id_ed25519.pub"), "ssh-ed25519 AAAA");
    fs.writeFileSync(path.join(sshDir, "config"), "Host x\n");
    fs.writeFileSync(path.join(sshDir, "known_hosts"), "");
    fs.writeFileSync(path.join(sshDir, "aliyun.pem"), "-----BEGIN RSA PRIVATE KEY-----\nxyz\n");
  });
  afterAll(() => fs.rmSync(home, { recursive: true, force: true }));

  it("lists only private key files", async () => {
    const keys = await Effect.runPromise(
      listLocalPrivateKeys(home).pipe(Effect.provide(NodeServices.layer)),
    );
    expect(keys.map((k) => k.label).toSorted()).toEqual(["aliyun.pem", "id_ed25519"]);
    expect(keys.every((k) => path.isAbsolute(k.path))).toBe(true);
  });

  it("returns an empty list without a ~/.ssh directory", async () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "djl-keys-empty-"));
    expect(
      await Effect.runPromise(listLocalPrivateKeys(empty).pipe(Effect.provide(NodeServices.layer))),
    ).toEqual([]);
    fs.rmSync(empty, { recursive: true, force: true });
  });
});
