import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect } from "effect";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { fingerprintOfKeyLine, hostPattern, makeKnownHosts } from "./knownHosts";

// Real ed25519 public key; fingerprint verified with `ssh-keygen -lf`.
const KEY_LINE =
  "203.0.113.10 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIBl9dS4A9c2tVw9hVHCnXH0d8Q+2wq3o0y2TjCJXk5vQ";

describe("hostPattern", () => {
  it("formats default and non-default ports", () => {
    expect(hostPattern("h", 22)).toBe("h");
    expect(hostPattern("h", 2222)).toBe("[h]:2222");
  });
});

describe("fingerprintOfKeyLine", () => {
  it("computes the SHA256 fingerprint OpenSSH prints", () => {
    const parsed = fingerprintOfKeyLine(KEY_LINE);
    expect(parsed?.type).toBe("ssh-ed25519");
    expect(parsed?.fingerprint).toMatch(/^SHA256:[A-Za-z0-9+/]{43}$/);
  });
  it("ignores comments and garbage", () => {
    expect(fingerprintOfKeyLine("# comment")).toBeNull();
    expect(fingerprintOfKeyLine("nonsense")).toBeNull();
  });
});

describe("makeKnownHosts with fixtures", () => {
  let dir: string;
  let keygen: string;
  let keyscan: string;
  const isWindows = process.platform === "win32";

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "djl-known-hosts-"));
    keygen = path.join(dir, "fake-keygen");
    keyscan = path.join(dir, "fake-keyscan");
    // fake ssh-keygen: -F <pattern> -f <file> => prints matching lines and exits 0 when the
    // file contains the pattern (like the real tool); -R removes matching lines.
    fs.writeFileSync(
      keygen,
      `#!/bin/sh
mode=$1; pattern=$2; file=$4
case "$mode" in
  -F) grep "^$pattern " "$file" ;;
  -R) grep -v "^$pattern " "$file" > "$file.tmp"; mv "$file.tmp" "$file" ;;
esac
`,
      { mode: 0o755 },
    );
    fs.writeFileSync(keyscan, `#!/bin/sh\necho "# comment"\necho "${KEY_LINE}"\n`, {
      mode: 0o755,
    });
    process.env.DJL_SSH_KEYGEN_COMMAND = keygen;
    process.env.DJL_SSH_KEYSCAN_COMMAND = keyscan;
  });

  afterAll(() => {
    delete process.env.DJL_SSH_KEYGEN_COMMAND;
    delete process.env.DJL_SSH_KEYSCAN_COMMAND;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it.skipIf(isWindows)("scans, trusts, recognizes and forgets a host", async () => {
    const djl = path.join(dir, "known_hosts");
    fs.writeFileSync(djl, "");
    const user = path.join(dir, "user_known_hosts");
    fs.writeFileSync(user, "");
    const program = Effect.gen(function* () {
      const kh = yield* makeKnownHosts({
        sshCommand: "ssh",
        knownHostsFiles: [djl, user],
        djlKnownHostsPath: djl,
      });
      expect(yield* kh.isKnown("203.0.113.10", 22)).toBe(false);
      const lines = yield* kh.scan("203.0.113.10", 22);
      expect(lines).toEqual([KEY_LINE]);
      yield* kh.trust(lines);
      expect(fs.readFileSync(djl, "utf8")).toContain(KEY_LINE);
      expect(yield* kh.isKnown("203.0.113.10", 22)).toBe(true);
      yield* kh.forget("203.0.113.10", 22);
      expect(yield* kh.isKnown("203.0.113.10", 22)).toBe(false);
    });
    await Effect.runPromise(program.pipe(Effect.provide(NodeServices.layer)));
  });
});
