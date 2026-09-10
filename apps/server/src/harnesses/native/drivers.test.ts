import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ThreadId, ProviderRuntimeEvent } from "@synara/contracts";
import { Schema } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCodexDriver } from "./codex";
import { createCursorDriver } from "./cursor";
import { createGrokDriver } from "./grok";
import { createKimiDriver } from "./kimi";
import { createIFlowDriver } from "./iflow";
import { createQwenDriver } from "./qwen";
import { createPiDriver } from "./pi";
import { createCodeBuddyDriver } from "./codebuddy";
import type { NativeSink } from "./types";

const dirs: string[] = [];
const fixture = (body: string, filename = "native-runtime") => {
  const dir = mkdtempSync(join(tmpdir(), "djl-driver-"));
  dirs.push(dir);
  const binary = join(dir, filename);
  writeFileSync(
    binary,
    `#!${process.execPath}\nif(process.argv.includes('--version')){console.log('codex-cli 0.153.4');process.exit(0)};const send=m=>process.stdout.write(JSON.stringify(m)+'\\n');const reply=(m,result)=>send({id:m.id,result});const note=(method,params)=>send({method,params});require('readline').createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);${body}});`,
  );
  chmodSync(binary, 0o700);
  return binary;
};
afterEach(() => {
  vi.unstubAllEnvs();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const input = {
  threadId: ThreadId.makeUnsafe("driver-test"),
  cwd: "/tmp",
  runtimeMode: "approval-required" as const,
};
const sink = (
  events: Record<string, unknown>[],
  request: NativeSink["request"] = async () => "decline",
): NativeSink => ({ emit: (event) => events.push(event), request, fail: () => {} });

describe("new official protocol drivers", () => {
  it("Kimi resumes, uses advertised permission choices, and cancels an active turn", async () => {
    const binary = fixture(`
      if(m.method==='initialize')reply(m,{protocolVersion:1,authMethods:[{id:'login'}],agentCapabilities:{loadSession:true}});
      if(m.method==='authenticate')reply(m,{});
      if(m.method==='session/load'){if(m.params.sessionId!=='kimi-resume')throw Error('bad resume');reply(m,{configOptions:[{id:'model',options:[{value:'kimi-code/k3',name:'Kimi K3'}]}],modes:{availableModes:[{id:'default'},{id:'plan'}]}})}
      if(m.method==='session/set_model'||m.method==='session/set_mode')reply(m,{});
      if(m.method==='session/prompt'){global.prompt=m.id;send({id:77,method:'session/request_permission',params:{sessionId:'kimi-resume',toolCall:{kind:'execute'},options:[{optionId:'reject-tool',kind:'reject_once'},{optionId:'allow-tool',kind:'allow_once'}]}})}
      if(m.id===77&&!m.method){if(m.result.outcome.optionId!=='reject-tool')throw Error('wrong permission');global.reviewed=true}
      if(m.method==='session/cancel'){if(!global.reviewed)throw Error('permission missing');send({id:global.prompt,result:{stopReason:'cancelled'}})}
    `);
    const events: Record<string, unknown>[] = [];
    const request = vi.fn(async () => "decline" as const);
    const driver = await createKimiDriver(
      {
        ...input,
        resumeCursor: { nativeSessionId: "kimi-resume" },
        providerOptions: { kimi: { binaryPath: binary } },
      },
      sink(events, request),
    );
    try {
      const turn = driver.send({ threadId: input.threadId, input: "Hello" });
      await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
      await driver.interrupt();
      await turn;
      expect(driver.id).toBe("kimi-resume");
      expect(events).toContainEqual({ type: "turn.completed", payload: { state: "interrupted" } });
    } finally {
      driver.close();
    }
  });
  it("Kimi validates existing OAuth and discovers only managed subscription models", async () => {
    vi.stubEnv("KIMI_MODEL_NAME", "metered-override");
    const binary = fixture(`
      if(process.argv[2]!=='acp'||process.env.KIMI_MODEL_NAME||process.env.KIMI_CODE_NO_AUTO_UPDATE!=='1')throw Error('wrong Kimi invocation');
      if(m.method==='initialize')reply(m,{protocolVersion:1,authMethods:[{id:'login',type:'terminal'}],agentCapabilities:{loadSession:true}});
      if(m.method==='authenticate'){if(m.params.methodId!=='login')throw Error('wrong auth');global.auth=true;reply(m,{})}
      if(m.method==='session/new'){if(!global.auth)throw Error('missing auth');reply(m,{sessionId:'kimi-test',configOptions:[{id:'model',category:'model',options:[{value:'openai/paid',name:'API model'},{value:'kimi-code/k3',name:'Kimi K3'}]}],modes:{currentModeId:'default',availableModes:[{id:'default'},{id:'plan'}]}})}
      if(m.method==='session/set_model'){if(m.params.modelId!=='kimi-code/k3')throw Error('API fallback');reply(m,{})}
      if(m.method==='session/set_mode')reply(m,{});
      if(m.method==='session/prompt'){note('session/update',{sessionId:'kimi-test',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'hello kimi'}}});reply(m,{stopReason:'end_turn'})}
    `);
    const events: Record<string, unknown>[] = [];
    const driver = await createKimiDriver(
      { ...input, providerOptions: { kimi: { binaryPath: binary } } },
      sink(events),
    );
    try {
      expect((await driver.models()).models).toEqual([{ slug: "kimi-code/k3", name: "Kimi K3" }]);
      await driver.send({ threadId: input.threadId, input: "Hello" });
      expect(events).toContainEqual(
        expect.objectContaining({
          type: "content.delta",
          payload: { streamKind: "assistant_text", delta: "hello kimi" },
        }),
      );
      await expect(
        driver.send({
          threadId: input.threadId,
          input: "Hello",
          modelSelection: { provider: "kimi", model: "openai/paid" },
        }),
      ).rejects.toThrow("subscription model");
    } finally {
      driver.close();
    }
  });
  it("iFlow uses the CLI's stored login, reads its _meta model catalog, and never opens a browser", async () => {
    vi.stubEnv("IFLOW_API_KEY", "must-not-replace-login");
    const binary = fixture(`
      if(process.env.IFLOW_API_KEY)throw Error('API key leaked into subscription runtime');
      if(process.argv.slice(2).join(' ')!=='--experimental-acp')throw Error('bad command');
      if(m.method==='initialize')reply(m,{protocolVersion:1,isAuthenticated:true,authMethods:[{id:'oauth-iflow'},{id:'iflow'}],agentCapabilities:{loadSession:true}});
      if(m.method==='authenticate')throw Error('authenticate would start a browser login');
      if(m.method==='session/new')reply(m,{sessionId:'iflow-test',modes:{currentModeId:'yolo',availableModes:[{id:'smart'},{id:'yolo'},{id:'default'},{id:'plan'}]},_meta:{models:{currentModelId:'glm-4.7',availableModels:[{id:'glm-4.7',name:'GLM-4.7'},{id:'kimi-k2.5',name:'Kimi-K2.5'}]}}});
      if(m.method==='session/set_model')reply(m,{});
      if(m.method==='session/set_mode'){if(m.params.modeId!=='plan')throw Error('wrong mode');reply(m,{})}
      if(m.method==='session/prompt'){note('session/update',{sessionId:'iflow-test',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'hello iflow'}}});reply(m,{stopReason:'end_turn'})}
    `);
    const events: Record<string, unknown>[] = [];
    const driver = await createIFlowDriver(
      { ...input, providerOptions: { iflow: { binaryPath: binary } } },
      sink(events),
    );
    try {
      expect((await driver.models()).models).toEqual([
        { slug: "glm-4.7", name: "GLM-4.7" },
        { slug: "kimi-k2.5", name: "Kimi-K2.5" },
      ]);
      await driver.send({ threadId: input.threadId, input: "Hello", interactionMode: "plan" });
      expect(events).toContainEqual(
        expect.objectContaining({
          type: "content.delta",
          payload: { streamKind: "assistant_text", delta: "hello iflow" },
        }),
      );
    } finally {
      driver.close();
    }
  });
  it("iFlow requires the official CLI sign-in instead of authenticating itself", async () => {
    const binary = fixture(`
      if(m.method==='initialize')reply(m,{protocolVersion:1,isAuthenticated:false,authMethods:[{id:'oauth-iflow'}],agentCapabilities:{loadSession:true}});
      if(m.method==='authenticate'||m.method==='session/new')throw Error('must not continue without login');
    `);
    await expect(
      createIFlowDriver({ ...input, providerOptions: { iflow: { binaryPath: binary } } }, sink([])),
    ).rejects.toThrow("Sign in with the official iFlow CLI");
  });
  it("Qwen Code uses only the CLI's stored provider setup and its advertised catalog", async () => {
    vi.stubEnv("OPENAI_API_KEY", "must-not-replace-cli-setup");
    const binary = fixture(`
      if(process.env.OPENAI_API_KEY)throw Error('API key leaked into subscription runtime');
      if(process.argv.slice(2).join(' ')!=='--acp')throw Error('bad command');
      if(m.method==='initialize')reply(m,{protocolVersion:1,authMethods:[{id:'openai'}],agentCapabilities:{loadSession:true}});
      if(m.method==='authenticate')throw Error('unexpected authenticate');
      if(m.method==='session/new')reply(m,{sessionId:'qwen-test',configOptions:[{id:'mode',category:'mode',options:[{value:'default'},{value:'plan'}]},{id:'model',category:'model',options:[{value:'qwen3-coder-plus',name:'Qwen3 Coder Plus'}]}],modes:{currentModeId:'default',availableModes:[{id:'plan'},{id:'default'},{id:'auto-edit'},{id:'yolo'}]}});
      if(m.method==='session/set_model'){if(m.params.modelId!=='qwen3-coder-plus')throw Error('wrong model');reply(m,{})}
      if(m.method==='session/set_mode'){if(m.params.modeId!=='default')throw Error('wrong mode');reply(m,{})}
      if(m.method==='session/prompt'){note('session/update',{sessionId:'qwen-test',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'hello qwen'}}});reply(m,{stopReason:'end_turn'})}
    `);
    const events: Record<string, unknown>[] = [];
    const driver = await createQwenDriver(
      {
        ...input,
        providerOptions: { qwen: { binaryPath: binary } },
        modelSelection: { provider: "qwen", model: "qwen3-coder-plus" },
      },
      sink(events),
    );
    try {
      expect((await driver.models()).models).toEqual([
        { slug: "qwen3-coder-plus", name: "Qwen3 Coder Plus" },
      ]);
      await driver.send({ threadId: input.threadId, input: "Hello" });
      expect(events).toContainEqual(
        expect.objectContaining({
          type: "content.delta",
          payload: { streamKind: "assistant_text", delta: "hello qwen" },
        }),
      );
    } finally {
      driver.close();
    }
  });
  it("Qwen Code surfaces the runtime's own sign-in requirement", async () => {
    const binary = fixture(`
      if(m.method==='initialize')reply(m,{protocolVersion:1,authMethods:[{id:'openai'}],agentCapabilities:{loadSession:true}});
      if(m.method==='session/new')send({id:m.id,error:{code:-32000,message:'Authentication required: Use Qwen Code CLI to authenticate first.'}});
    `);
    await expect(
      createQwenDriver({ ...input, providerOptions: { qwen: { binaryPath: binary } } }, sink([])),
    ).rejects.toThrow("Authentication required");
  });
  it("Pi drives RPC mode, routes approvals through its extension UI, and streams text", async () => {
    const binary = fixture(`
      const argv=process.argv.slice(2);
      if(argv[0]!=='--mode'||argv[1]!=='rpc'||argv[2]!=='--session-id'||!argv[3])throw Error('bad command '+argv.join(' '));
      if(argv[4]!=='-e'||!argv[5].endsWith('djl-approvals.ts'))throw Error('approval extension missing');
      if(process.env.DJL_PI_APPROVE!=='command,file'||process.env.PI_SKIP_VERSION_CHECK!=='1')throw Error('bad env');
      const ok=(data)=>send({id:m.id,type:'response',command:m.type,success:true,data});
      if(m.type==='get_state')ok({sessionId:argv[3],model:{id:'claude-sonnet-4-5',provider:'anthropic',name:'Claude Sonnet 4.5'},thinkingLevel:'medium'});
      if(m.type==='set_model'){if(m.provider!=='anthropic'||m.modelId!=='claude-haiku-4-5')throw Error('wrong model');ok({id:'claude-haiku-4-5',provider:'anthropic',name:'Claude Haiku 4.5'})}
      if(m.type==='set_thinking_level'){if(m.level!=='high')throw Error('wrong level');ok({})}
      if(m.type==='get_available_models')ok({models:[{id:'claude-haiku-4-5',provider:'anthropic',name:'Claude Haiku 4.5'}]});
      if(m.type==='prompt'){ok({});send({type:'agent_start'});send({type:'message_start',message:{role:'assistant'}});send({type:'extension_ui_request',id:'ui-1',method:'confirm',title:'djl-approval:command:bash',message:'ls'})}
      if(m.type==='extension_ui_response'){if(m.id!=='ui-1'||m.confirmed!==false)throw Error('wrong answer');send({type:'tool_execution_start',toolCallId:'t1',toolName:'bash',args:{command:'ls'}});send({type:'tool_execution_end',toolCallId:'t1',toolName:'bash',result:'blocked',isError:true});send({type:'message_update',message:{role:'assistant'},assistantMessageEvent:{type:'text_delta',delta:'hello pi'}});send({type:'message_end',message:{role:'assistant',stopReason:'stop'}});send({type:'agent_end'});send({type:'agent_settled'})}
    `);
    const events: Record<string, unknown>[] = [];
    const request = vi.fn(async () => "decline" as const);
    const driver = await createPiDriver(
      { ...input, providerOptions: { pi: { binaryPath: binary } } },
      sink(events, request),
    );
    try {
      expect((await driver.models()).models).toEqual([
        { slug: "anthropic/claude-haiku-4-5", name: "Claude Haiku 4.5" },
      ]);
      await driver.send({
        threadId: input.threadId,
        input: "Hello",
        modelSelection: {
          provider: "pi",
          model: "anthropic/claude-haiku-4-5",
          options: { thinkingLevel: "high" },
        },
      });
      expect(request).toHaveBeenCalledWith("command_execution_approval", {
        toolName: "bash",
        summary: "ls",
      });
      expect(events).toContainEqual(
        expect.objectContaining({
          type: "content.delta",
          payload: { streamKind: "assistant_text", delta: "hello pi" },
        }),
      );
      expect(events).toContainEqual(
        expect.objectContaining({
          type: "item.completed",
          itemId: "t1",
          payload: expect.objectContaining({ status: "failed", title: "bash" }),
        }),
      );
    } finally {
      driver.close();
    }
  });
  it("Pi reports the runtime's sign-in error and skips approvals in full access", async () => {
    const binary = fixture(`
      const argv=process.argv.slice(2);
      if(argv.includes('-e')||process.env.DJL_PI_APPROVE)throw Error('unexpected approval extension');
      const ok=(data)=>send({id:m.id,type:'response',command:m.type,success:true,data});
      if(m.type==='get_state')ok({sessionId:'pi-session',model:{id:'unknown',provider:'unknown'}});
      if(m.type==='prompt')send({id:m.id,type:'response',command:'prompt',success:false,error:'No API key found for the selected model.\\n\\nUse /login to log into a provider via OAuth or API key.'});
    `);
    await expect(
      createPiDriver(
        { ...input, runtimeMode: "full-access", providerOptions: { pi: { binaryPath: binary } } },
        sink([]),
      ),
    ).rejects.toThrow("Sign in to Pi");
  });
  it("CodeBuddy Code uses the CLI's stored account and never calls ACP authenticate", async () => {
    vi.stubEnv("CODEBUDDY_API_KEY", "must-not-replace-login");
    vi.stubEnv("CODEBUDDY_INTERNET_ENVIRONMENT", "internal");
    const binary = fixture(`
      if(process.env.CODEBUDDY_API_KEY||process.env.CODEBUDDY_INTERNET_ENVIRONMENT||process.env.DISABLE_AUTOUPDATER!=='1')throw Error('bad env');
      if(process.argv.slice(2).join(' ')!=='--acp')throw Error('bad command');
      if(m.method==='initialize')reply(m,{protocolVersion:1,authMethods:[{id:'external',name:'Login with Google/Github'},{id:'internal',name:'Login with WeChat'}],agentCapabilities:{loadSession:true}});
      if(m.method==='authenticate')throw Error('authenticate would log the account out');
      if(m.method==='session/new')reply(m,{sessionId:'cb-test',models:{currentModelId:'default-model',availableModels:[{modelId:'default-model',name:'Auto'},{modelId:'deep-model',name:'Deep'}]},modes:{currentModeId:'default',availableModes:[{id:'default'},{id:'acceptEdits'},{id:'plan'}]}});
      if(m.method==='session/set_model'){if(m.params.modelId!=='deep-model')throw Error('wrong model');reply(m,{})}
      if(m.method==='session/set_mode'){if(m.params.modeId!=='default')throw Error('wrong mode');reply(m,{})}
      if(m.method==='session/prompt'){send({id:9,method:'session/request_permission',params:{sessionId:'cb-test',toolCall:{kind:'edit'},options:[{kind:'allow_always',optionId:'allow_always'},{kind:'allow_once',optionId:'allow'},{kind:'reject_once',optionId:'reject'}]}});global.prompt=m}
      if(m.id===9&&!m.method){if(m.result.outcome.optionId!=='allow')throw Error('wrong permission');note('session/update',{sessionId:'cb-test',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'hello codebuddy'}}});reply(global.prompt,{stopReason:'end_turn'})}
    `);
    const events: Record<string, unknown>[] = [];
    const request = vi.fn(async () => "accept" as const);
    const driver = await createCodeBuddyDriver(
      {
        ...input,
        providerOptions: { codebuddy: { binaryPath: binary } },
        modelSelection: { provider: "codebuddy", model: "deep-model" },
      },
      sink(events, request),
    );
    try {
      expect((await driver.models()).models).toEqual([
        { slug: "default-model", name: "Auto" },
        { slug: "deep-model", name: "Deep" },
      ]);
      await driver.send({ threadId: input.threadId, input: "Hello" });
      expect(request).toHaveBeenCalledWith("file_change_approval", expect.anything());
      expect(events).toContainEqual(
        expect.objectContaining({
          type: "content.delta",
          payload: { streamKind: "assistant_text", delta: "hello codebuddy" },
        }),
      );
    } finally {
      driver.close();
    }
  });
  it("Grok uses cached subscription authentication and advertised modes without API-key fallback", async () => {
    vi.stubEnv("XAI_API_KEY", "must-not-use-metered-api");
    const binary = fixture(`
      if(process.env.XAI_API_KEY)throw Error('API key leaked into subscription runtime');
      if(process.argv.slice(2).join(' ')!=='--no-auto-update agent stdio')throw Error('bad command');
      if(m.method==='initialize')reply(m,{protocolVersion:1,authMethods:[{id:'cached_token'},{id:'xai.api_key'}],agentCapabilities:{loadSession:true}});
      if(m.method==='authenticate'){if(m.params.methodId!=='cached_token'||m.params._meta.headless!==true)throw Error('unsafe auth');global.auth=true;reply(m,{})}
      if(m.method==='session/load'){if(!global.auth)throw Error('missing auth');reply(m,{models:{availableModels:[{modelId:'grok-test',name:'Grok'}]},modes:{currentModeId:'default',availableModes:[{id:'default'},{id:'plan'}]}})}
      if(m.method==='session/set_model')reply(m,{});
      if(m.method==='session/set_mode'){if(m.params.modeId!=='default')throw Error('invented mode');reply(m,{})}
      if(m.method==='session/prompt'){note('session/update',{sessionId:'grok-resume',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'hello grok'}}});reply(m,{stopReason:'end_turn'})}
    `);
    const events: Record<string, unknown>[] = [];
    const driver = await createGrokDriver(
      {
        ...input,
        resumeCursor: { nativeSessionId: "grok-resume" },
        providerOptions: { grok: { binaryPath: binary } },
      },
      sink(events),
    );
    try {
      expect((await driver.models()).models[0]?.slug).toBe("grok-test");
      await driver.send({ threadId: input.threadId, input: "Hello" });
      expect(events).toContainEqual(
        expect.objectContaining({
          type: "content.delta",
          payload: { streamKind: "assistant_text", delta: "hello grok" },
        }),
      );
    } finally {
      driver.close();
    }
  });

  it("Grok refuses browser authentication during background discovery", async () => {
    const binary = fixture(`
      if(m.method==='initialize')reply(m,{protocolVersion:1,authMethods:[{id:'oauth'},{id:'xai.api_key'}],agentCapabilities:{}});
      if(m.method==='authenticate'||m.method==='session/new')throw Error('must not authenticate interactively');
    `);
    await expect(
      createGrokDriver({ ...input, providerOptions: { grok: { binaryPath: binary } } }, sink([])),
    ).rejects.toThrow("Sign in to Grok");
  });

  it("runs a configured Cursor editor launcher through its agent subcommand", async () => {
    vi.stubEnv("PATH", "");
    const binary = fixture(
      `
      if(process.argv[2]!=='agent'||process.argv[3]!=='-e'||process.argv[4]!=='https://cursor.example'||process.argv[5]!=='acp')throw Error('incorrect editor invocation');
      if(m.method==='initialize')reply(m,{protocolVersion:1,agentCapabilities:{}});
      if(m.method==='authenticate')reply(m,{});
      if(m.method==='session/new')reply(m,{sessionId:'editor-session',models:{availableModels:[]}});
    `,
      "cursor",
    );
    const driver = await createCursorDriver(
      {
        ...input,
        providerOptions: { cursor: { binaryPath: binary, apiEndpoint: "https://cursor.example" } },
      },
      sink([]),
    );
    try {
      expect(driver.id).toBe("editor-session");
    } finally {
      driver.close();
    }
  });

  it("Codex resumes, streams tools and waits for explicit permission before completion", async () => {
    const binary = fixture(`
      if(m.method==='initialize') reply(m,{});
      if(m.method==='thread/resume') {if(m.params.threadId!=='resume-me'||m.params.approvalPolicy!=='on-request'||m.params.sandbox!=='read-only') throw Error('bad start');reply(m,{thread:{id:'resume-me'}})}
      if(m.method==='model/list') reply(m,{data:[{model:'native-model',displayName:'Native Model'}],nextCursor:null});
      if(m.method==='turn/start') {note('turn/started',{threadId:'resume-me',turn:{id:'turn-native'}});reply(m,{turn:{id:'turn-native'}});note('item/agentMessage/delta',{threadId:'resume-me',itemId:'assistant',delta:'hello'});note('item/started',{threadId:'resume-me',item:{id:'tool',type:'commandExecution'}});send({id:901,method:'item/commandExecution/requestApproval',params:{threadId:'resume-me',turnId:'turn-native',itemId:'tool',command:'echo test'}})}
      if(m.id===901&&!m.method){if(m.result.decision!=='decline')throw Error('wrong decision');note('item/completed',{threadId:'resume-me',item:{id:'tool',type:'commandExecution',status:'declined'}});note('turn/completed',{threadId:'resume-me',turn:{id:'turn-native',status:'completed'}})}
    `);
    const events: Record<string, unknown>[] = [];
    let release!: () => void;
    let requested!: () => void;
    const received = new Promise<void>((resolve) => {
      requested = resolve;
    });
    const driver = await createCodexDriver(
      {
        ...input,
        resumeCursor: { nativeSessionId: "resume-me" },
        approvalPolicy: "on-request",
        sandboxMode: "read-only",
        runtimeMode: "full-access",
        providerOptions: { codex: { binaryPath: binary } },
      },
      sink(events, async () => {
        requested();
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return "decline";
      }),
    );
    try {
      expect((await driver.models()).models[0]?.slug).toBe("native-model");
      let done = false;
      const turn = driver.send({ threadId: input.threadId, input: "Hello" }).then(() => {
        done = true;
      });
      await received;
      expect(done).toBe(false);
      release();
      await turn;
      expect(events.some((event) => event.type === "content.delta")).toBe(true);
      expect(events.some((event) => event.type === "item.completed")).toBe(true);
    } finally {
      driver.close();
    }
  });

  it("Cursor resumes without opening login, selects a model and uses advertised approval option ids", async () => {
    const binary = fixture(`
      if(m.method==='initialize') {if(m.params.clientCapabilities.terminal!==false)throw Error('terminal capability');reply(m,{protocolVersion:1,agentCapabilities:{loadSession:true}})}
      if(m.method==='authenticate') throw Error('Background authentication must never open a browser');
      if(m.method==='session/load') reply(m,{models:{availableModels:[{modelId:'native-cursor',name:'Cursor'}]}});
      if(m.method==='session/set_model'||m.method==='session/set_mode')reply(m,{});
      if(m.method==='session/prompt'){global.promptId=m.id;note('session/update',{sessionId:'cursor-resume',update:{sessionUpdate:'usage_update',used:24000,size:200000}});note('session/update',{sessionId:'cursor-resume',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'hello cursor'}}});send({id:88,method:'session/request_permission',params:{sessionId:'cursor-resume',toolCall:{toolCallId:'tool'},options:[{optionId:'explicit-deny',kind:'reject_once'},{optionId:'explicit-allow',kind:'allow_once'}]}})}
      if(m.id===88&&!m.method){if(m.result.outcome.optionId!=='explicit-deny')throw Error('incorrect approval');send({id:global.promptId,result:{stopReason:'end_turn'}})}
    `);
    const events: Record<string, unknown>[] = [];
    const driver = await createCursorDriver(
      {
        ...input,
        resumeCursor: { nativeSessionId: "cursor-resume" },
        modelSelection: { provider: "cursor", model: "native-cursor" },
        providerOptions: { cursor: { binaryPath: binary } },
      },
      sink(events),
    );
    try {
      expect((await driver.models()).models[0]?.slug).toBe("native-cursor");
      await driver.send({ threadId: input.threadId, input: "Hello" });
      expect(events).toContainEqual({
        type: "thread.token-usage.updated",
        payload: { usage: expect.objectContaining({ usedTokens: 24000, maxTokens: 200000 }) },
      });
      expect(events).toContainEqual({
        type: "content.delta",
        itemId: expect.stringMatching(/^assistant-/),
        payload: { streamKind: "assistant_text", delta: "hello cursor" },
      });
    } finally {
      driver.close();
    }
  });

  it("preserves Codex reasoning metadata, dispatches settings, and forwards current context usage", async () => {
    const binary = fixture(`
      if(m.method==='initialize')reply(m,{});
      if(m.method==='thread/start')reply(m,{thread:{id:'usage-thread'}});
      if(m.method==='model/list')reply(m,{data:[{model:'gpt-5.6-sol',displayName:'GPT-5.6 Sol',supportedReasoningEfforts:[{reasoningEffort:'high',description:'Deep reasoning'},{reasoningEffort:'ultra',description:'Maximum reasoning'}],defaultReasoningEffort:'high',additionalSpeedTiers:['fast']}],nextCursor:null});
      if(m.method==='turn/start'){
        if(m.params.effort!=='ultra'||m.params.serviceTier!=='fast')throw Error('Thinking options lost');
        reply(m,{turn:{id:'t'}});
        note('thread/tokenUsage/updated',{threadId:'usage-thread',tokenUsage:{total:{totalTokens:90000},last:{totalTokens:12000,inputTokens:11000,outputTokens:1000},modelContextWindow:200000}});
        note('turn/completed',{threadId:'usage-thread',turn:{id:'t',status:'completed'}});
      }
    `);
    const events: Record<string, unknown>[] = [];
    const driver = await createCodexDriver(
      { ...input, providerOptions: { codex: { binaryPath: binary } } },
      sink(events),
    );
    try {
      expect((await driver.models()).models[0]).toMatchObject({
        supportedReasoningEfforts: [{ value: "high" }, { value: "ultra" }],
        defaultReasoningEffort: "high",
        supportsFastMode: true,
      });
      await driver.send({
        threadId: input.threadId,
        input: "hi",
        modelSelection: {
          provider: "codex",
          model: "gpt-5.6-sol",
          options: { reasoningEffort: "ultra", fastMode: true },
        },
      });
      expect(events).toContainEqual({
        type: "thread.token-usage.updated",
        payload: {
          usage: expect.objectContaining({
            usedTokens: 12000,
            totalProcessedTokens: 90000,
            maxTokens: 200000,
          }),
        },
      });
    } finally {
      driver.close();
    }
  });

  it.each([false, true])(
    "uses the native auto reviewer and keeps review sessions separate (resume=%s)",
    async (resume) => {
      const binary = fixture(`
      if(m.method==='initialize') reply(m,{});
      if(m.method==='configRequirements/read') reply(m,{requirements:null});
      if(m.method==='thread/start'||m.method==='thread/resume') {
        if(m.params.approvalsReviewer!=='auto_review'||m.params.approvalPolicy!=='on-request'||m.params.sandbox!=='workspace-write')throw Error('Wrong review profile');
        reply(m,{thread:{id:'review-main'},approvalsReviewer:'auto_review',approvalPolicy:'on-request',sandbox:{type:'workspaceWrite'}});
      }
      if(m.method==='turn/start') {
        reply(m,{turn:{id:'rt'}});
        note('item/autoApprovalReview/started',{threadId:'review-main',reviewId:'r1',review:{status:'inProgress',rationale:''}});
        note('item/agentMessage/delta',{threadId:'hidden-review',itemId:'hidden',delta:'private reviewer instructions'});
        note('item/autoApprovalReview/completed',{threadId:'review-main',reviewId:'r1',review:{status:'denied',rationale:'Outside approved scope'}});
        note('turn/completed',{threadId:'review-main',turn:{id:'rt',status:'completed'}});
      }
    `);
      const events: Record<string, unknown>[] = [];
      const driver = await createCodexDriver(
        {
          ...input,
          runtimeMode: "auto-approval",
          ...(resume ? { resumeCursor: { nativeSessionId: "review-main" } } : {}),
          providerOptions: { codex: { binaryPath: binary } },
        },
        sink(events),
      );
      try {
        await driver.send({ threadId: input.threadId, input: "hi" });
        expect(events).toContainEqual({
          type: "item.completed",
          itemId: "auto-review-r1",
          payload: expect.objectContaining({
            title: "Codex automatic review: denied",
            detail: "Outside approved scope",
          }),
        });
        expect(events.some((e) => e.type === "content.delta")).toBe(false);
        events.forEach((event, index) =>
          Schema.decodeUnknownSync(ProviderRuntimeEvent)({
            ...event,
            eventId: `review-${index}`,
            provider: "codex",
            threadId: input.threadId,
            createdAt: new Date().toISOString(),
          }),
        );
      } finally {
        driver.close();
      }
    },
  );

  it("rejects a native reviewer override instead of mislabeling the active profile", async () => {
    const binary = fixture(`
      if(m.method==='initialize')reply(m,{});
      if(m.method==='thread/start')reply(m,{thread:{id:'mismatch'},approvalsReviewer:'auto_review',approvalPolicy:'on-request'});
    `);
    await expect(
      createCodexDriver({ ...input, providerOptions: { codex: { binaryPath: binary } } }, sink([])),
    ).rejects.toThrow("permission mode is unavailable");
  });

  it("rejects Cursor resume when native runtime does not advertise it", async () => {
    const binary = fixture(
      "if(m.method==='initialize')reply(m,{protocolVersion:1,agentCapabilities:{}});if(m.method==='authenticate')reply(m,{});",
    );
    await expect(
      createCursorDriver(
        {
          ...input,
          resumeCursor: { nativeSessionId: "existing" },
          providerOptions: { cursor: { binaryPath: binary } },
        },
        sink([]),
      ),
    ).rejects.toThrow("does not support session resume");
  });
});
