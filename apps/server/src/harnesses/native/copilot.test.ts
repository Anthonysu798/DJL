import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_SERVER_SETTINGS, ThreadId } from "@djl/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildHarnessInvocation } from "../accounts";
import { createCopilotDriver, probeCopilotSubscriptionAccount } from "./copilot";
import { nativeProfileOptions } from "./profile";
import type { NativeSink } from "./types";

const dirs: string[] = [];
const fixture = (body: string) => {
  const dir = mkdtempSync(join(tmpdir(), "djl-copilot-"));
  dirs.push(dir);
  const binary = join(dir, "copilot");
  writeFileSync(
    binary,
    `#!${process.execPath}\nconst send=m=>process.stdout.write(JSON.stringify(m)+'\\n');const reply=(m,result)=>send({id:m.id,result});const note=(method,params)=>send({method,params});require('readline').createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);${body}});`,
  );
  chmodSync(binary, 0o700);
  return binary;
};
afterEach(() => {
  vi.unstubAllEnvs();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const input = {
  threadId: ThreadId.makeUnsafe("copilot-test"),
  cwd: "/tmp",
  runtimeMode: "approval-required" as const,
};
const sink = (events: Record<string, unknown>[]): NativeSink => ({
  emit: (event) => events.push(event),
  request: async () => "decline",
  fail: () => {},
});

describe("GitHub Copilot CLI harness", () => {
  it("signs in with `copilot login` and keeps BYOK settings out of the subscription", () => {
    const env = {
      COPILOT_PROVIDER_BASE_URL: "https://example.test/v1",
      COPILOT_PROVIDER_API_KEY: "byok-secret",
      COPILOT_MODEL: "byok-model",
      GH_TOKEN: "github-token",
      PATH: "/usr/bin",
    };
    const copilot = buildHarnessInvocation("copilot", DEFAULT_SERVER_SETTINGS, "/tmp", env);
    expect([copilot.binary, ...copilot.prefixArgs, ...copilot.loginArgs]).toEqual([
      "copilot",
      "login",
    ]);
    expect(copilot.env.COPILOT_PROVIDER_BASE_URL).toBeUndefined();
    expect(copilot.env.COPILOT_PROVIDER_API_KEY).toBeUndefined();
    expect(copilot.env.COPILOT_MODEL).toBeUndefined();
    expect(copilot.env.GH_TOKEN).toBe("github-token");
    expect(copilot.env.PATH).toBe("/usr/bin");
    expect(nativeProfileOptions("copilot", DEFAULT_SERVER_SETTINGS)).toEqual({
      copilot: { binaryPath: "copilot" },
    });
  });

  it("runs `copilot --acp --stdio` with the advertised catalog and plan mode", async () => {
    vi.stubEnv("COPILOT_PROVIDER_API_KEY", "must-not-replace-subscription");
    vi.stubEnv("GH_TOKEN", "github-token");
    const binary = fixture(`
      if(process.argv.slice(2).join(' ')!=='--acp --stdio')throw Error('bad command');
      if(process.env.COPILOT_PROVIDER_API_KEY)throw Error('BYOK key leaked into subscription runtime');
      if(process.env.GH_TOKEN!=='github-token')throw Error('GitHub token removed');
      if(m.method==='initialize')reply(m,{protocolVersion:1,agentCapabilities:{loadSession:true}});
      if(m.method==='authenticate')throw Error('unexpected authenticate');
      if(m.method==='session/new')reply(m,{sessionId:'copilot-session',models:{currentModelId:'auto',availableModels:[{modelId:'auto',name:'Auto'},{modelId:'gpt-5',name:'GPT-5'}]},modes:{currentModeId:'agent',availableModes:[{id:'agent'},{id:'plan'}]}});
      if(m.method==='session/set_model'){if(m.params.modelId!=='gpt-5')throw Error('wrong model');reply(m,{})}
      if(m.method==='session/set_mode'){if(m.params.modeId!=='plan')throw Error('wrong mode');reply(m,{})}
      if(m.method==='session/prompt'){note('session/update',{sessionId:'copilot-session',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'hello copilot'}}});reply(m,{stopReason:'end_turn'})}
    `);
    const events: Record<string, unknown>[] = [];
    const driver = await createCopilotDriver(
      {
        ...input,
        providerOptions: { copilot: { binaryPath: binary } },
        modelSelection: { provider: "copilot", model: "gpt-5" },
      },
      sink(events),
    );
    try {
      expect((await driver.models()).models).toEqual([
        { slug: "auto", name: "Auto" },
        { slug: "gpt-5", name: "GPT-5" },
      ]);
      await driver.send({ threadId: input.threadId, input: "Hello", interactionMode: "plan" });
      expect(events).toContainEqual(
        expect.objectContaining({
          type: "content.delta",
          payload: { streamKind: "assistant_text", delta: "hello copilot" },
        }),
      );
    } finally {
      driver.close();
    }
  });

  it("reports account state from a session attempt", async () => {
    const ready = fixture(
      `if(m.method==='initialize')reply(m,{protocolVersion:1});if(m.method==='session/new')reply(m,{sessionId:'s'});`,
    );
    const required = fixture(
      `if(m.method==='initialize')reply(m,{protocolVersion:1});if(m.method==='session/new')send({id:m.id,error:{code:-32000,message:'Authentication required: run copilot login.'}});`,
    );
    expect(await probeCopilotSubscriptionAccount(ready, "/tmp")).toBe("ready");
    expect(await probeCopilotSubscriptionAccount(required, "/tmp")).toBe("required");
  });
});
