import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_SERVER_SETTINGS } from "@synara/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { buildHarnessInvocation } from "./accounts";
import { nativeProfileOptions } from "./native/profile";
import { probeIFlowSubscriptionAccount } from "./native/iflow";
import { probeQwenSubscriptionAccount } from "./native/qwen";

const dirs: string[] = [];
const fixture = (body: string) => {
  const dir = mkdtempSync(join(tmpdir(), "djl-cli-account-"));
  dirs.push(dir);
  const binary = join(dir, "runtime");
  writeFileSync(
    binary,
    `#!${process.execPath}\nconst send=m=>process.stdout.write(JSON.stringify(m)+'\\n');const reply=(m,result)=>send({id:m.id,result});require('readline').createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);${body}});`,
  );
  chmodSync(binary, 0o700);
  return binary;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("iFlow and Qwen Code accounts", () => {
  it("opens the interactive CLIs for sign-in without any inherited API credentials", () => {
    const env = {
      IFLOW_API_KEY: "iflow-secret",
      IFLOW_BASE_URL: "https://example.test",
      OPENAI_API_KEY: "openai-secret",
      OPENAI_BASE_URL: "https://example.test/v1",
      QWEN_DEFAULT_AUTH_TYPE: "openai",
      PATH: "/usr/bin",
    };
    const iflow = buildHarnessInvocation("iflow", DEFAULT_SERVER_SETTINGS, "/tmp", env);
    const qwen = buildHarnessInvocation("qwen", DEFAULT_SERVER_SETTINGS, "/tmp", env);
    expect(iflow.binary).toBe("iflow");
    expect(iflow.loginArgs).toEqual([]);
    expect(iflow.env.IFLOW_API_KEY).toBeUndefined();
    expect(iflow.env.IFLOW_BASE_URL).toBeUndefined();
    expect(iflow.env.PATH).toBe("/usr/bin");
    expect(qwen.binary).toBe("qwen");
    expect(qwen.loginArgs).toEqual([]);
    expect(qwen.env.OPENAI_API_KEY).toBeUndefined();
    expect(qwen.env.OPENAI_BASE_URL).toBeUndefined();
    expect(qwen.env.QWEN_DEFAULT_AUTH_TYPE).toBeUndefined();
    expect(nativeProfileOptions("iflow", DEFAULT_SERVER_SETTINGS)).toEqual({
      iflow: { binaryPath: "iflow" },
    });
    expect(nativeProfileOptions("qwen", DEFAULT_SERVER_SETTINGS)).toEqual({
      qwen: { binaryPath: "qwen" },
    });
  });
  it("reports iFlow account state from the runtime's initialize response", async () => {
    const ready = fixture(
      `if(m.method==='initialize')reply(m,{protocolVersion:1,isAuthenticated:true,authMethods:[]});`,
    );
    const required = fixture(
      `if(m.method==='initialize')reply(m,{protocolVersion:1,isAuthenticated:false,authMethods:[]});`,
    );
    expect(await probeIFlowSubscriptionAccount(ready, "/tmp")).toBe("ready");
    expect(await probeIFlowSubscriptionAccount(required, "/tmp")).toBe("required");
  });
  it("reports Qwen Code account state from a session attempt", async () => {
    const ready = fixture(
      `if(m.method==='initialize')reply(m,{protocolVersion:1,authMethods:[]});if(m.method==='session/new')reply(m,{sessionId:'s'});`,
    );
    const required = fixture(
      `if(m.method==='initialize')reply(m,{protocolVersion:1,authMethods:[]});if(m.method==='session/new')send({id:m.id,error:{code:-32000,message:'Authentication required: Use Qwen Code CLI to authenticate first.'}});`,
    );
    expect(await probeQwenSubscriptionAccount(ready, "/tmp")).toBe("ready");
    expect(await probeQwenSubscriptionAccount(required, "/tmp")).toBe("required");
  });
});
