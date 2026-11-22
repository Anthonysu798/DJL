import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ThreadId } from "@djl/contracts";
import { afterEach, expect, it } from "vitest";
import { createCodexDriver } from "./codex";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

// A Codex app-server stand-in that reports a rolling rate-limit update mid-turn.
// The notification carries no threadId, exactly like `account/rateLimits/updated` in the
// v2 protocol (AccountRateLimitsUpdatedNotification = { rateLimits: RateLimitSnapshot }).
function fixture(body: string) {
  const dir = mkdtempSync(join(tmpdir(), "djl-codex-limits-"));
  dirs.push(dir);
  const binary = join(dir, "codex");
  writeFileSync(
    binary,
    `#!${process.execPath}\nconst send=m=>process.stdout.write(JSON.stringify(m)+'\\n');const reply=(m,result)=>send({id:m.id,result});const note=(method,params)=>send({method,params});require('readline').createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);${body}});`,
  );
  chmodSync(binary, 0o700);
  return binary;
}

it("forwards Codex rate-limit updates during a turn as the runtime rate-limit event", async () => {
  const snapshot = {
    limitId: "codex",
    limitName: null,
    normalModelSlug: null,
    primary: { usedPercent: 92, windowDurationMins: 300, resetsAt: 4_102_444_800 },
    secondary: null,
    credits: null,
    individualLimit: null,
    spendControlReached: null,
    planType: "plus",
    rateLimitReachedType: null,
  };
  const binary = fixture(`
    if(m.method==='initialize')reply(m,{});
    if(m.method==='thread/start')reply(m,{thread:{id:'limits-thread'}});
    if(m.method==='turn/start'){
      reply(m,{turn:{id:'t'}});
      note('account/rateLimits/updated',{rateLimits:${JSON.stringify(snapshot)}});
      note('turn/completed',{threadId:'limits-thread',turn:{id:'t',status:'completed'}});
    }
  `);
  const events: Record<string, unknown>[] = [];
  const driver = await createCodexDriver(
    {
      threadId: ThreadId.makeUnsafe("codex-limits"),
      cwd: "/tmp",
      runtimeMode: "approval-required",
      providerOptions: { codex: { binaryPath: binary } },
    },
    { emit: (event) => events.push(event), request: async () => "decline", fail: () => {} },
  );
  try {
    await driver.send({ threadId: ThreadId.makeUnsafe("codex-limits"), input: "hi" });
    // Same payload the old Codex adapter produced: the notification params under `rateLimits`.
    expect(events).toContainEqual({
      type: "account.rate-limits.updated",
      payload: { rateLimits: { rateLimits: snapshot } },
    });
  } finally {
    driver.close();
  }
});
