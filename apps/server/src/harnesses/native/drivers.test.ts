import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ThreadId, ProviderRuntimeEvent } from "@synara/contracts";
import { Schema } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCodexDriver } from "./codex";
import { createCursorDriver } from "./cursor";
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
