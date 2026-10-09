const test = require("node:test");
const assert = require("node:assert/strict");
const { createRemoteProviderCatalog } = require("../src/remote-provider-catalog");
function fixture() {
  const calls = [];
  const request = async (tag, payload) => {
    calls.push([tag, payload]);
    if (tag === "server.getConfig")
      return {
        providers: [
          { provider: "codex", available: true, authStatus: "authenticated" },
          { provider: "claudeAgent", available: true, authStatus: "authenticated" },
          { provider: "opencode", available: false, authStatus: "unknown" },
        ],
      };
    return {
      models: [
        {
          slug: payload.provider === "codex" ? "gpt-6-astra" : "claude-sonnet-4-6",
          name: payload.provider === "codex" ? "GPT-6 Astra" : "Claude Sonnet 4.6",
          supportedReasoningEfforts: [{ value: "high" }],
        },
      ],
    };
  };
  return { catalog: createRemoteProviderCatalog(request), calls };
}
test("uses configured desktop catalogs and distinct provider/model identities", async () => {
  const { catalog, calls } = fixture();
  const result = await catalog.list();
  assert.deepEqual(
    result.items.map((m) => [m.djlProvider, m.displayName]),
    [
      ["codex", "GPT-6 Astra"],
      ["claudeAgent", "Claude Sonnet 4.6"],
    ],
  );
  assert.equal(result.items[0].id, "codex::gpt-6-astra");
  assert.equal(result.items[0].providerDisplayName, "Codex");
  assert.ok(!result.items.some((m) => m.model === "openai/gpt-5"));
  assert.equal(calls.filter(([tag]) => tag === "provider.listModels").length, 2);
  await catalog.list();
  assert.equal(calls.filter(([tag]) => tag === "server.getConfig").length, 1);
});
test("rejects cross-provider model IDs before dispatch", async () => {
  const { catalog } = fixture();
  await assert.rejects(
    catalog.resolve(
      { model: "openai/gpt-5", djlProvider: "codex" },
      { provider: "codex", model: "gpt-6-astra" },
    ),
    /not available for Codex/,
  );
});
test("explicit provider selection routes Claude correctly", async () => {
  const { catalog } = fixture();
  assert.deepEqual(
    await catalog.resolve(
      { model: "claude-sonnet-4-6", djlProvider: "claudeAgent" },
      { provider: "codex", model: "gpt-6-astra" },
    ),
    { provider: "claudeAgent", model: "claude-sonnet-4-6" },
  );
});
test("empty catalogs never invent a default model", async () => {
  const catalog = createRemoteProviderCatalog(async () => ({ providers: [] }));
  assert.deepEqual((await catalog.list()).items, []);
  await assert.rejects(catalog.resolve({}, null), /Connect a provider/);
});

for (const [provider, key] of [
  ["codex", "reasoningEffort"],
  ["claudeAgent", "effort"],
  ["pi", "thinkingLevel"],
  ["opencode", "variant"],
]) {
  test(`${provider} uses its native reasoning option key`, async () => {
    const catalog = createRemoteProviderCatalog(async (tag) =>
      tag === "server.getConfig"
        ? { providers: [{ provider, available: true, authStatus: "authenticated" }] }
        : {
            models: [
              { slug: "model", name: "Model", supportedReasoningEfforts: [{ value: "high" }] },
            ],
          },
    );
    assert.deepEqual(
      await catalog.resolve({ model: "model", djlProvider: provider, effort: "high" }, null),
      { provider, model: "model", options: { [key]: "high" } },
    );
    assert.deepEqual(
      await catalog.resolve({}, { provider, model: "model", options: { [key]: "high" } }),
      { provider, model: "model", options: { [key]: "high" } },
    );
  });
}

test("maps explicit fast and default speed to provider options", async () => {
  const catalog = createRemoteProviderCatalog(async (tag) =>
    tag === "server.getConfig"
      ? { providers: [{ provider: "codex", available: true, authStatus: "authenticated" }] }
      : { models: [{ slug: "gpt", name: "GPT", supportsFastMode: true }] },
  );
  assert.deepEqual(
    (await catalog.resolve({ model: "gpt", djlProvider: "codex", serviceTier: "fast" }, null))
      .options,
    { fastMode: true },
  );
  assert.deepEqual(
    (
      await catalog.resolve(
        { model: "gpt", djlProvider: "codex", serviceTier: "default" },
        { provider: "codex", model: "gpt", options: { fastMode: true } },
      )
    ).options,
    { fastMode: false },
  );
});
