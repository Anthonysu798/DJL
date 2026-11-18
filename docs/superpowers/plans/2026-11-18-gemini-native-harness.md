# Native Gemini Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Gemini CLI a working native subscription agent in DJL, selectable in chats and
manageable in Settings > Accounts, the same way Qwen Code is.

**Architecture:** Gemini CLI speaks the Agent Client Protocol with `gemini --acp`. DJL already has
a shared ACP driver (`createNativeAcpDriver`) and already has Gemini's provider kind, model
catalog, settings and health probe; this plan adds the driver and registers it everywhere Qwen
Code is registered. Commit `c9d6ff42c` (the change that added Qwen Code) is the worked example.

**Tech Stack:** TypeScript, Effect, Vitest, the existing `NativeRpc` ACP bridge.

**Spec:** `docs/superpowers/specs/2026-11-18-multi-agents-design.md` (section "Gemini"). This is
slice 1 of that spec and is independent of the rest.

## Global Constraints

- Product name is DJL. Never write a retired product name; `bun run brand:check` must pass.
- User-visible strings in `apps/web` come from the seven locale catalogs in
  `apps/web/src/i18n/locales` (`en`, `es-419`, `fr`, `ja`, `ko`, `zh-Hans`, `zh-Hant`), identical
  keys in canonical order.
- Run workspace tests with `bun run --cwd <package> test <file>`, never `bun test`.
  `apps/server` tests run on one worker: always pass a file filter while iterating.
- DJL never passes an API key of its own into a subscription runtime.
- Never use the real `~/.djl` state for a test; `bun run electron:dev` uses isolated state.
- Surgical diffs: touch only what registering Gemini needs.

## Review Focus

- **Gemini CLI too old to know `--acp`:** the user sees a message naming Gemini CLI and asking them
  to update it, not a raw spawn error. (Task 1)
- **Not signed in:** starting a session reports that sign-in is required; no browser window opens
  by itself. (Task 1)
- **A model id that is not in the CLI's catalog:** the turn fails with the CLI's own message
  instead of hanging. (Task 1)
- **`loadSession` not advertised:** resuming a saved chat fails with "Gemini CLI runtime does not
  support session resume" (existing shared behaviour); record in Task 5 whether the installed CLI
  advertises it, because the Multi agents plan depends on the answer.
- **A custom binary path with spaces:** the path from Settings is used as given. (Task 3)

---

### Task 1: Gemini ACP driver

**Files:**

- Create: `apps/server/src/harnesses/native/gemini.ts`
- Modify: `apps/server/src/harnesses/native/types.ts` (add `"gemini"` to `NativeProvider`)
- Modify: `apps/server/src/harnesses/native/profile.ts` (add the `gemini` case)
- Test: `apps/server/src/harnesses/native/drivers.test.ts`

**Interfaces:**

- Consumes: `createNativeAcpDriver` from `./acp`; `NativeRpc`, `object` from `./protocol`;
  `buildGeminiProbeEnv` from `../../provider/geminiAcpProbe`.
- Produces:
  - `geminiSubscriptionEnvironment(base?: NodeJS.ProcessEnv): NodeJS.ProcessEnv`
  - `createGeminiDriver: NativeDriverFactory`
  - `probeGeminiSubscriptionAccount(binary: string, cwd: string): Promise<"ready" | "required" | "unknown" | "incompatible">`
  - `nativeProfileOptions("gemini", settings)` returns
    `{ gemini: { binaryPath: settings.providers.gemini.binaryPath.trim() || "gemini" } }`

- [ ] **Step 1: Write the failing tests** in `drivers.test.ts`, beside the Qwen Code tests and
      using the same `fixture`, `input` and `sink` helpers.

```ts
it("Gemini CLI runs ACP with the browser blocked and its advertised catalog", async () => {
  const binary = fixture(`
    if(process.argv.slice(2).join(' ')!=='--acp')throw Error('bad command');
    if(process.env.NO_BROWSER!=='true')throw Error('browser not blocked');
    if(m.method==='initialize')reply(m,{protocolVersion:1,agentCapabilities:{loadSession:true}});
    if(m.method==='session/new')reply(m,{sessionId:'gemini-test',models:{availableModels:[{modelId:'gemini-2.5-pro',name:'Gemini 2.5 Pro'}]},modes:{currentModeId:'default',availableModes:[{id:'default'},{id:'plan'}]}});
    if(m.method==='session/set_model'){if(m.params.modelId!=='gemini-2.5-pro')throw Error('wrong model');reply(m,{})}
    if(m.method==='session/set_mode'){if(m.params.modeId!=='default')throw Error('wrong mode');reply(m,{})}
    if(m.method==='session/prompt'){note('session/update',{sessionId:'gemini-test',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'hello gemini'}}});reply(m,{stopReason:'end_turn'})}
  `);
  const events: Record<string, unknown>[] = [];
  const driver = await createGeminiDriver(
    {
      ...input,
      providerOptions: { gemini: { binaryPath: binary } },
      modelSelection: { provider: "gemini", model: "gemini-2.5-pro" },
    },
    sink(events),
  );
  try {
    expect((await driver.models()).models).toEqual([
      { slug: "gemini-2.5-pro", name: "Gemini 2.5 Pro" },
    ]);
    await driver.send({ threadId: input.threadId, input: "Hello" });
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "content.delta",
        payload: { streamKind: "assistant_text", delta: "hello gemini" },
      }),
    );
  } finally {
    driver.close();
  }
});

it("Gemini CLI surfaces the runtime's own sign-in requirement", async () => {
  const binary = fixture(`
    if(m.method==='initialize')reply(m,{protocolVersion:1,agentCapabilities:{loadSession:true}});
    if(m.method==='session/new')send({id:m.id,error:{code:-32000,message:'Authentication required'}});
  `);
  await expect(
    createGeminiDriver({ ...input, providerOptions: { gemini: { binaryPath: binary } } }, sink([])),
  ).rejects.toThrow("Authentication required");
});

it("Gemini CLI that exits before the handshake asks the user to update it", async () => {
  const binary = fixture(`process.stderr.write('Unknown argument: acp');process.exit(1);`);
  await expect(
    createGeminiDriver({ ...input, providerOptions: { gemini: { binaryPath: binary } } }, sink([])),
  ).rejects.toThrow(/Gemini CLI.*update/i);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `bun run --cwd apps/server test src/harnesses/native/drivers.test.ts`
Expected: FAIL, `createGeminiDriver` is not exported.

- [ ] **Step 3: Implement `gemini.ts`** on the pattern of `qwen.ts`.
  - `geminiSubscriptionEnvironment` returns `buildGeminiProbeEnv(base)`, so the driver and the
    existing health probe see the same environment and no OAuth browser opens.
  - `createGeminiDriver` uses `label: "Gemini CLI"`, `source: "gemini.acp"`, command
    `input.providerOptions?.gemini?.binaryPath?.trim() || "gemini"` with args `["--acp"]`, and the
    same `modeId` mapping as `qwen.ts` (error text `Gemini CLI does not advertise ${desired} mode.`).
  - Wrap the factory: when the child closes before `initialize` answers, rethrow as
    `Gemini CLI could not start in agent mode. Update Gemini CLI and try again.` with the original
    message appended.
  - `probeGeminiSubscriptionAccount` mirrors `probeQwenSubscriptionAccount` with the Gemini env.
  - Before coding, read Gemini CLI's ACP documentation and adjust only if the flag is no longer
    `--acp` (DJL's own `apps/server/src/provider/geminiAcpProbe.ts` uses `--acp` today).

- [ ] **Step 4: Run to verify they pass**

Run: `bun run --cwd apps/server test src/harnesses/native/drivers.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/harnesses/native/gemini.ts apps/server/src/harnesses/native/types.ts \
  apps/server/src/harnesses/native/profile.ts apps/server/src/harnesses/native/drivers.test.ts
git commit -m "Add Gemini CLI native ACP driver"
```

### Task 2: Register the adapter

**Files:**

- Modify: `apps/server/src/harnesses/native/layer.ts`
- Modify: `apps/server/src/provider/Layers/ProviderAdapterRegistry.ts`
- Test: `apps/server/src/provider/Layers/ProviderAdapterRegistry.test.ts`

**Interfaces:**

- Consumes: `createGeminiDriver` (Task 1).
- Produces: `NativeGeminiAdapter` service tag `"djl/native/GeminiAdapter"`, included in
  `NativeHarnessesLive` and in the registry's default adapter list.

- [ ] **Step 1: Write the failing test.** In the existing test that resolves the fake native
      adapters, add a `fakeGeminiAdapter` built like `fakeGrokAdapter` and assert, in that file's
      `assert` style:

```ts
assert.equal(yield * registry.getByProvider("gemini"), fakeGeminiAdapter);
assert.ok((yield * registry.listProviders()).includes("gemini"));
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun run --cwd apps/server test src/provider/Layers/ProviderAdapterRegistry.test.ts`
Expected: FAIL with `ProviderUnsupportedError` for `gemini`.

- [ ] **Step 3: Add `NativeGeminiAdapter`** and
      `Layer.effect(NativeGeminiAdapter, makeConfiguredNativeAdapter("gemini", createGeminiDriver))`
      in `layer.ts`, and `yield* NativeGeminiAdapter` in the registry list after the Cursor entry.

- [ ] **Step 4: Run to verify it passes**, then run `bun run ci:desktop:typecheck`.
      Expected: PASS, no type errors.

- [ ] **Step 5: Commit** (`git commit -m "Register the native Gemini adapter"`).

### Task 3: Accounts, sign-in and tool updates

**Files:**

- Modify: `packages/contracts/src/harnessAccounts.ts` (`HarnessId` gains `"gemini"`)
- Modify: `apps/server/src/harnesses/accounts.ts`, `login.ts`, `tools.ts`
- Test: `packages/contracts/src/harnessAccounts.test.ts`
- Test: create `apps/server/src/harnesses/geminiAccount.test.ts`

**Interfaces:**

- Consumes: `geminiSubscriptionEnvironment`, `probeGeminiSubscriptionAccount` (Task 1).
- Produces: `buildHarnessInvocation("gemini", settings, root, env)` returning
  `{ binary, prefixArgs: [], loginArgs: [], statusArgs: ["--version"], env }`; a `gemini` entry in
  `NATIVE_HARNESS_IDS` and in `TOOL_IDS`.

- [ ] **Step 1: Write the failing tests.**

```ts
// harnessAccounts.test.ts
expect(Schema.decodeUnknownSync(HarnessId)("gemini")).toBe("gemini");

// geminiAccount.test.ts
it("uses the configured binary, no login subcommand and a blocked browser", () => {
  const settings = settingsWith({ gemini: { binaryPath: "/opt/my tools/gemini" } });
  const invocation = buildHarnessInvocation("gemini", settings, "/tmp/root", { PATH: "/bin" });
  expect(invocation.binary).toBe("/opt/my tools/gemini");
  expect(invocation.loginArgs).toEqual([]);
  expect(invocation.statusArgs).toEqual(["--version"]);
  expect(invocation.env.NO_BROWSER).toBe("true");
});
it("falls back to gemini on PATH", () => {
  const invocation = buildHarnessInvocation("gemini", settingsWith({}), "/tmp/root", {});
  expect(invocation.binary).toBe("gemini");
});
```

Build `settingsWith` the way `apps/server/src/harnesses/chineseCliAccounts.test.ts` builds its
settings fixture.

- [ ] **Step 2: Run to verify they fail**

Run: `bun run --cwd packages/contracts test src/harnessAccounts.test.ts` and
`bun run --cwd apps/server test src/harnesses/geminiAccount.test.ts`
Expected: FAIL (`"gemini"` is not a `HarnessId`).

- [ ] **Step 3: Implement.**
  - `accounts.ts`: add `gemini` to `NATIVE_HARNESS_IDS`; add the invocation branch; add the status
    branch that calls `probeGeminiSubscriptionAccount(invocation.binary, process.cwd())`.
  - `login.ts`: add `request.harness === "gemini"` to the `removeEnv` list. Sign in opens the
    interactive CLI in the embedded terminal, as for Qwen Code; the sign-in terminal must not
    inherit `NO_BROWSER`, so pass the base environment there, not the driver environment.
  - `tools.ts`: add `gemini` to `TOOL_IDS` using the existing Gemini maintenance definition in
    `apps/server/src/provider/Layers/ProviderHealth.ts` (npm `@google/gemini-cli`, Homebrew
    formula `gemini-cli`).

- [ ] **Step 4: Run to verify they pass**, then `bun run ci:desktop:typecheck`. Expected: PASS.

- [ ] **Step 5: Commit** (`git commit -m "Add Gemini CLI to accounts, sign-in and tool updates"`).

### Task 4: Renderer

**Files:**

- Modify: `apps/web/src/providerOrdering.ts`
- Modify: `apps/web/src/components/settings/HarnessAccountsPanel.tsx`
- Modify: `apps/web/src/components/settings/HarnessToolsPanel.tsx`
- Modify: `apps/web/src/components/PluginLibrary.tsx`
- Modify: every `apps/web/src/i18n/locales/*.json` only if the panels hold per-agent strings for
  Qwen Code (search each catalog for `qwen` and mirror exactly those keys for `gemini`)
- Test: `apps/web/src/providerOrdering.test.ts`

**Interfaces:**

- Produces: `"gemini"` in `DEFAULT_PROVIDER_ORDER` directly after `"claudeAgent"`; rows
  `{ id: "gemini", label: "Gemini CLI", docs: "https://github.com/google-gemini/gemini-cli" }`
  in both panels.

- [ ] **Step 1: Write the failing test.**

```ts
expect(isProviderKind("gemini")).toBe(true);
expect(DEFAULT_PROVIDER_ORDER.indexOf("gemini")).toBe(
  DEFAULT_PROVIDER_ORDER.indexOf("claudeAgent") + 1,
);
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun run --cwd apps/web test src/providerOrdering.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** the order entry, the two panel rows, and the capability query entry in
      `PluginLibrary.tsx` next to the Qwen Code one.

- [ ] **Step 4: Run the checks.**

Run: `bun run --cwd apps/web test src/providerOrdering.test.ts`, `bun run ci:desktop:typecheck`,
`bun run ci:desktop:lint`, `bun run i18n:check` (compare its count with the count on `main`).
Expected: tests PASS; the i18n count does not rise.

- [ ] **Step 5: Commit** (`git commit -m "Show Gemini CLI in pickers and account settings"`).

### Task 5: Documentation and live verification

**Files:**

- Modify: `docs/harness-accounts.md`

- [ ] **Step 1: Document.** Add Gemini CLI to the opening list of native integrations, to the
      plans table (connection: "The official Gemini CLI's own sign-in and ACP runtime"), and to
      the Provider tools list.

- [ ] **Step 2: Run the full desktop checks.**

Run: `bun run ci:desktop:format`, `ci:desktop:lint`, `ci:desktop:typecheck`, `ci:desktop:test`,
`bun run brand:check`.
Expected: all PASS.

- [ ] **Step 3: Verify a real turn.** Run `bun run electron:dev`. In Settings > Accounts confirm
      Gemini CLI shows installed and its sign-in state. Start a chat with Gemini, send
      `Reply with exactly: DJL OK`, and confirm the reply. Quit, relaunch, reopen the chat and send
      a second message.

- [ ] **Step 4: Record what you observed** in `docs/harness-accounts.md` under a dated
      "Gemini verification" heading: CLI version, whether `--acp` was accepted, whether the second
      message after relaunch resumed the session (that is, whether the CLI advertises
      `loadSession`). If you could not sign in, say so; do not claim a verified turn.

- [ ] **Step 5: Commit** (`git commit -m "Document the native Gemini agent"`).
