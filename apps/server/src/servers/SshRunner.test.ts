import * as NodeServices from "@effect/platform-node/NodeServices";
import { ServerId, type ServerRecord } from "@synara/contracts";
import { Effect, Layer } from "effect";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ServerSecretStoreLive } from "../auth/Layers/ServerSecretStore";
import { ServerConfig } from "../config";
import { makeSshRunnerLayer, SshRunner } from "./SshRunner";

const isWindows = process.platform === "win32";
let fixtureDir: string;
let fakeSsh: string;
let captureFile: string;

// The fake ssh records its argv and, when DJL_SSH_SECRET_FILE is set, the secret the
// askpass helper would print; it exits per the FAKE_SSH_MODE env variable.
beforeAll(() => {
  fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "djl-ssh-runner-"));
  captureFile = path.join(fixtureDir, "capture.json");
  fakeSsh = path.join(fixtureDir, isWindows ? "fake-ssh.cmd" : "fake-ssh");
  const script = isWindows
    ? `@echo off\r\n(echo {"args":"%*","secretFile":"%DJL_SSH_SECRET_FILE%","askpass":"%SSH_ASKPASS%"}) > "${captureFile}"\r\nif "%FAKE_SSH_MODE%"=="denied" (echo Permission denied 1>&2 & exit /b 255)\r\nif "%FAKE_SSH_MODE%"=="hang" (ping -n 60 127.0.0.1 > nul)\r\necho stdout-ok\r\nexit /b 0\r\n`
    : `#!/bin/sh
secret=""
if [ -n "$DJL_SSH_SECRET_FILE" ]; then secret=$("$SSH_ASKPASS"); fi
printf '{"args":%s,"secret":"%s","secretFileExisted":%s}' "$(printf '%s\\n' "$@" | python3 -c 'import json,sys;print(json.dumps(sys.stdin.read().split("\\n")[:-1]))')" "$secret" "$([ -n "$DJL_SSH_SECRET_FILE" ] && [ -f "$DJL_SSH_SECRET_FILE" ] && echo true || echo false)" > "${captureFile}"
case "$FAKE_SSH_MODE" in
  denied) echo "Permission denied (publickey)." >&2; exit 255 ;;
  hang) exec sleep 60 ;;
esac
echo stdout-ok
exit 0
`;
  fs.writeFileSync(fakeSsh, script, { mode: 0o755 });
});

afterAll(() => {
  fs.rmSync(fixtureDir, { recursive: true, force: true });
});

const server = (auth: ServerRecord["auth"]): ServerRecord => ({
  id: ServerId.makeUnsafe("srv-1"),
  name: "n",
  host: "203.0.113.10",
  port: 22,
  username: "u",
  auth,
  tags: [],
  permissionTier: "read-only",
  notes: "",
  source: "manual",
  createdAt: 1,
  updatedAt: 1,
});

const makeLayer = () =>
  makeSshRunnerLayer({ sshCommand: fakeSsh }).pipe(
    Layer.provideMerge(ServerSecretStoreLive),
    Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "djl-ssh-runner-test-" })),
    Layer.provide(NodeServices.layer),
  );

const run = <A>(effect: Effect.Effect<A, unknown, SshRunner>) =>
  effect.pipe(Effect.provide(makeLayer()), Effect.scoped, Effect.runPromise);

const readCapture = () =>
  JSON.parse(fs.readFileSync(captureFile, "utf8")) as {
    args: string[] | string;
    secret?: string;
    secretFileExisted?: boolean;
    secretFile?: string;
  };

describe("SshRunner", () => {
  it("runs the command and returns stdout on success", async () => {
    process.env.FAKE_SSH_MODE = "ok";
    const result = await run(
      Effect.flatMap(SshRunner.asEffect(), (r) =>
        r.run({ server: server({ type: "agent" }), command: "echo ok", secret: null }),
      ),
    );
    expect(result.outcome).toBe("ok");
    expect(result.stdout.trim()).toBe("stdout-ok");
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    const capture = readCapture();
    expect(JSON.stringify(capture.args)).toContain("StrictHostKeyChecking=yes");
  });

  it.skipIf(isWindows)(
    "delivers a password through askpass and deletes the secret file afterwards",
    async () => {
      process.env.FAKE_SSH_MODE = "ok";
      const result = await run(
        Effect.flatMap(SshRunner.asEffect(), (r) =>
          r.run({ server: server({ type: "password" }), command: "true", secret: "hunter2" }),
        ),
      );
      expect(result.outcome).toBe("ok");
      const capture = readCapture();
      expect(capture.secret).toBe("hunter2");
      expect(capture.secretFileExisted).toBe(true);
      expect(JSON.stringify(capture.args)).not.toContain("hunter2");
      // The askpass directory must be empty once the run completes.
      const runner = await run(Effect.map(SshRunner.asEffect(), (r) => r));
      const askpassDir = path.join(path.dirname(runner.djlKnownHostsPath), "askpass");
      expect(fs.existsSync(askpassDir) ? fs.readdirSync(askpassDir) : []).toEqual([]);
    },
  );

  it("classifies a denied login and sanitizes the message", async () => {
    process.env.FAKE_SSH_MODE = "denied";
    const result = await run(
      Effect.flatMap(SshRunner.asEffect(), (r) =>
        r.run({ server: server({ type: "agent" }), command: "true", secret: null }),
      ),
    );
    expect(result.outcome).toBe("auth-failed");
    expect(result.message).toContain("Permission denied");
    expect(result.stderr).toContain("Permission denied");
  });

  it("kills a hanging ssh and reports timeout", async () => {
    process.env.FAKE_SSH_MODE = "hang";
    const result = await run(
      Effect.flatMap(SshRunner.asEffect(), (r) =>
        r.run({
          server: server({ type: "agent" }),
          command: "true",
          secret: null,
          timeoutMs: 500,
        }),
      ),
    );
    expect(result.outcome).toBe("timeout");
  }, 10_000);

  it("reports capabilities from ssh -V", async () => {
    const capabilities = await run(Effect.flatMap(SshRunner.asEffect(), (r) => r.capabilities()));
    expect(typeof capabilities.askpassSupported).toBe("boolean");
  });
});
