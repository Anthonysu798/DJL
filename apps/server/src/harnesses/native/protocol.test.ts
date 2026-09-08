import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { NativeRpc, prepareNativeRpcLaunch } from "./protocol";
import { codexPermissions } from "./codex";
import { ThreadId } from "@synara/contracts";

const temporary: string[] = [];
function fixture(source: string) {
  const dir = mkdtempSync(join(tmpdir(), "djl-native-"));
  temporary.push(dir);
  const path = join(dir, "runtime.cjs");
  writeFileSync(path, source);
  return new NativeRpc(process.execPath, [path], dir);
}
afterEach(() => {
  for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("native NDJSON transport", () => {
  it("prepares Windows npm shims with the same safe launch flags as Accounts", () => {
    const launch = prepareNativeRpcLaunch(
      "codex",
      ["app-server", "literal value"],
      "C:\\project",
      { ComSpec: "C:\\Windows\\System32\\cmd.exe" },
      { platform: "win32", spawnSync: () => ({ status: 0, stdout: "C:\\Tools\\codex.cmd\r\n" }) },
    );
    expect(launch.command).toBe("C:\\Windows\\System32\\cmd.exe");
    expect(launch.args.slice(0, 4)).toEqual(["/d", "/s", "/v:off", "/c"]);
    expect(launch.args[4]).toContain("codex.cmd");
    expect(launch.args[4]).toContain("app-server");
    expect(() =>
      prepareNativeRpcLaunch(
        "C:\\Tools\\codex.cmd",
        ["unsafe & command"],
        "C:\\project",
        {},
        { platform: "win32" },
      ),
    ).toThrow("Cannot safely execute");
    expect(launch.options).toMatchObject({
      shell: false,
      windowsHide: true,
      windowsVerbatimArguments: true,
      stdio: "pipe",
    });
  });

  it("correlates requests, preserves literal arguments and rejects unsupported requests", async () => {
    const rpc = fixture(
      `const r=require('readline').createInterface({input:process.stdin});r.on('line',line=>{const m=JSON.parse(line);if(m.method)process.stdout.write(JSON.stringify({id:m.id,result:m.params})+'\\n')});`,
    );
    try {
      expect(await rpc.request("echo", { text: "$(do-not-run); `literal`" })).toEqual({
        text: "$(do-not-run); `literal`",
      });
    } finally {
      rpc.close();
    }
  });
  it("bounds pending calls and rejects all of them when the process exits", async () => {
    const rpc = fixture("process.stdin.resume(); setTimeout(()=>process.exit(2),50)");
    await expect(rpc.request("initialize", {})).rejects.toThrow("exited");
    await expect(rpc.request("after-close", {})).rejects.toThrow("closed");
  });
  it("terminates malformed JSON and times out an unresponsive runtime", async () => {
    const bad = fixture(
      "process.stdin.once('data',()=>process.stdout.write('invalid json\\n'));process.stdin.resume()",
    );
    await expect(bad.request("initialize", {})).rejects.toThrow();
    const idle = fixture("process.stdin.resume()");
    await expect(idle.request("initialize", {}, 25)).rejects.toThrow("timed out");
    idle.close();
  });
  it("maps explicit Codex policies without widening them", () => {
    const base = { threadId: ThreadId.makeUnsafe("test"), runtimeMode: "full-access" as const };
    expect(
      codexPermissions({ ...base, approvalPolicy: "untrusted", sandboxMode: "read-only" }),
    ).toEqual({ approvalPolicy: "untrusted", sandbox: "read-only", approvalsReviewer: "user" });
    expect(codexPermissions({ ...base, runtimeMode: "approval-required" })).toEqual({
      approvalsReviewer: "user",
      approvalPolicy: "untrusted",
      sandbox: "workspace-write",
    });
  });
});
