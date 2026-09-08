import { describe, expect, it } from "vitest";

import { buildSshArgs, buildSshEnv, knownHostsOptionValue } from "./sshArgs";

const base = {
  host: "203.0.113.10",
  port: 2222,
  username: "deploy",
  auth: { type: "agent" as const },
};
const knownHostsFiles = ["/state/ssh/known_hosts", "/home/me/.ssh/known_hosts"];

describe("buildSshArgs", () => {
  it("always enforces strict host key checking and both known_hosts files", () => {
    const plan = buildSshArgs({
      server: base,
      command: "echo ok",
      knownHostsFiles,
      importedKeyPath: null,
    });
    expect(plan.args).toContain("StrictHostKeyChecking=yes");
    expect(plan.args).toContain(`UserKnownHostsFile=${knownHostsOptionValue(knownHostsFiles)}`);
    expect(plan.args.at(-1)).toBe("echo ok");
    expect(plan.args).toContain("deploy@203.0.113.10");
    expect(plan.args.slice(plan.args.indexOf("-p"), plan.args.indexOf("-p") + 2)).toEqual([
      "-p",
      "2222",
    ]);
  });

  it("uses batch mode and no askpass for agent auth", () => {
    const plan = buildSshArgs({
      server: base,
      command: "true",
      knownHostsFiles,
      importedKeyPath: null,
    });
    expect(plan.args).toContain("BatchMode=yes");
    expect(plan.args).toContain("PasswordAuthentication=no");
    expect(plan.needsAskpass).toBe(false);
  });

  it("passes -i and IdentitiesOnly for a key path, and askpass only when it has a passphrase", () => {
    const noPass = buildSshArgs({
      server: { ...base, auth: { type: "keyPath", path: "/k/id", hasPassphrase: false } },
      command: "true",
      knownHostsFiles,
      importedKeyPath: null,
    });
    expect(noPass.args).toContain("/k/id");
    expect(noPass.args).toContain("IdentitiesOnly=yes");
    expect(noPass.needsAskpass).toBe(false);
    const withPass = buildSshArgs({
      server: { ...base, auth: { type: "keyPath", path: "/k/id", hasPassphrase: true } },
      command: "true",
      knownHostsFiles,
      importedKeyPath: null,
    });
    expect(withPass.needsAskpass).toBe(true);
    expect(withPass.askpassSecretKind).toBe("passphrase");
    expect(withPass.args).not.toContain("BatchMode=yes");
  });

  it("points -i at the imported key path", () => {
    const plan = buildSshArgs({
      server: { ...base, auth: { type: "importedKey", hasPassphrase: false } },
      command: "true",
      knownHostsFiles,
      importedKeyPath: "/secrets/server.x.privateKey.bin",
    });
    expect(plan.args).toContain("/secrets/server.x.privateKey.bin");
  });

  it("prefers password auth and requires askpass for password", () => {
    const plan = buildSshArgs({
      server: { ...base, auth: { type: "password" } },
      command: "true",
      knownHostsFiles,
      importedKeyPath: null,
    });
    expect(plan.args).toContain("PreferredAuthentications=password");
    expect(plan.args).toContain("PubkeyAuthentication=no");
    expect(plan.args).toContain("NumberOfPasswordPrompts=1");
    expect(plan.needsAskpass).toBe(true);
    expect(plan.askpassSecretKind).toBe("password");
    expect(plan.args.join(" ")).not.toContain("hunter2");
  });

  it("never emits a secret and never lets the command be parsed as options", () => {
    const plan = buildSshArgs({
      server: base,
      command: "-oProxyCommand=x",
      knownHostsFiles,
      importedKeyPath: null,
    });
    const dashDash = plan.args.indexOf("--");
    expect(dashDash).toBeGreaterThan(-1);
    expect(plan.args.indexOf("-oProxyCommand=x")).toBeGreaterThan(dashDash);
  });
});

describe("buildSshEnv", () => {
  it("adds askpass variables only when requested", () => {
    const plain = buildSshEnv({ PATH: "/bin" }, null);
    expect(plain.SSH_ASKPASS).toBeUndefined();
    const withAskpass = buildSshEnv(
      { PATH: "/bin" },
      { helperPath: "/h/djl-askpass", secretFilePath: "/s/1" },
    );
    expect(withAskpass.SSH_ASKPASS).toBe("/h/djl-askpass");
    expect(withAskpass.SSH_ASKPASS_REQUIRE).toBe("force");
    expect(withAskpass.DJL_SSH_SECRET_FILE).toBe("/s/1");
    expect(withAskpass.DISPLAY).toBe("djl");
  });

  it("keeps an existing DISPLAY", () => {
    expect(buildSshEnv({ DISPLAY: ":0" }, { helperPath: "/h", secretFilePath: "/s" }).DISPLAY).toBe(
      ":0",
    );
  });
});

describe("knownHostsOptionValue", () => {
  it("quotes paths so spaces survive", () => {
    expect(knownHostsOptionValue(["/a b/known_hosts", "/c/known_hosts"])).toBe(
      '"/a b/known_hosts" "/c/known_hosts"',
    );
  });
});
