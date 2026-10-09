// Canonical desktop provider discovery, shared by the phone picker and turn validation.
const LABELS = {
  codex: "Codex",
  claudeAgent: "Claude",
  cursor: "Cursor",
  gemini: "Gemini",
  grok: "Grok",
  kimi: "Kimi Code",
  droid: "Droid",
  kilo: "Kilo",
  opencode: "OpenCode",
  pi: "Pi",
};
const EFFORT_KEYS = {
  codex: "reasoningEffort",
  claudeAgent: "effort",
  cursor: "reasoningEffort",
  gemini: "thinkingLevel",
  grok: "reasoningEffort",
  droid: "reasoningEffort",
  opencode: "variant",
  kilo: "variant",
  pi: "thinkingLevel",
};
const effortKeyFor = (provider) => EFFORT_KEYS[provider];
const text = (value) => (typeof value === "string" ? value.trim() : "");

function createRemoteProviderCatalog(request) {
  let cached = null;
  let expiresAt = 0;
  let pending = null;
  let generation = 0;
  async function list() {
    if (cached && Date.now() < expiresAt) return cached;
    if (pending) return pending;
    const version = generation;
    pending = (async () => {
      const config = await request("server.getConfig", {});
      const providers = (config.providers || []).filter(
        (p) => p.available && p.status !== "error" && p.authStatus !== "unauthenticated",
      );
      const results = await Promise.allSettled(
        providers.map((p) => request("provider.listModels", { provider: p.provider })),
      );
      const items = [];
      const errors = [];
      const ids = new Set();
      for (let i = 0; i < providers.length; i++) {
        const provider = providers[i].provider;
        const providerDisplayName = LABELS[provider] || provider;
        const result = results[i];
        if (result.status !== "fulfilled") {
          errors.push({
            provider,
            providerDisplayName,
            message: "Model discovery failed. Check this provider on your computer.",
          });
          continue;
        }
        for (const model of result.value.models || []) {
          if (!text(model.slug)) continue;
          const id = `${provider}::${model.slug}`;
          if (ids.has(id)) continue;
          ids.add(id);
          items.push({
            id,
            model: model.slug,
            displayName: text(model.name) || model.slug,
            description: text(model.description),
            djlProvider: provider,
            providerDisplayName,
            isDefault: items.length === 0,
            supportsFastMode: model.supportsFastMode === true,
            supportedReasoningEfforts: (model.supportedReasoningEfforts || []).map(
              (effort) => effort.value,
            ),
            defaultReasoningEffort: model.defaultReasoningEffort || null,
          });
        }
      }
      const result = { items, nextCursor: null, providerErrors: errors };
      if (generation === version) {
        cached = result;
        expiresAt = Date.now() + 60000;
      }
      return result;
    })().finally(() => {
      pending = null;
    });
    return pending;
  }
  return {
    list,
    invalidate() {
      generation++;
      cached = null;
      expiresAt = 0;
    },
    async resolve(params, existing) {
      const { items } = await list();
      if (!items.length)
        throw new Error(
          "Connect a provider in DJL desktop Settings, then refresh the phone's model list.",
        );
      const provider = text(params.djlProvider) || text(existing?.provider);
      const model =
        text(params.model) ||
        text(params.collaborationMode?.settings?.model) ||
        text(existing?.model);
      const candidates = items.filter(
        (item) =>
          (!provider || item.djlProvider === provider) &&
          (!model || item.model === model || item.id === model),
      );
      const selected = candidates[0];
      if (!selected)
        throw new Error(
          `Model '${model || "default"}' is not available for ${LABELS[provider] || provider || "this provider"}. Refresh the model list and choose a matching provider and model.`,
        );
      if (!provider && model && candidates.length > 1)
        throw new Error("Choose a provider for this model in the phone's model picker.");
      const effort =
        text(params.effort) ||
        text(params.collaborationMode?.settings?.reasoning_effort) ||
        (selected.djlProvider === existing?.provider
          ? text(existing?.options?.[effortKeyFor(existing?.provider)])
          : "");
      const options = {};
      if (
        effort &&
        effortKeyFor(selected.djlProvider) &&
        selected.supportedReasoningEfforts.includes(effort)
      )
        options[effortKeyFor(selected.djlProvider)] = effort;
      if (selected.supportsFastMode) {
        if (params.serviceTier != null) options.fastMode = params.serviceTier === "fast";
        else if (
          existing?.provider === selected.djlProvider &&
          typeof existing.options?.fastMode === "boolean"
        )
          options.fastMode = existing.options.fastMode;
      }
      return {
        provider: selected.djlProvider,
        model: selected.model,
        ...(Object.keys(options).length ? { options } : {}),
      };
    },
  };
}
module.exports = { createRemoteProviderCatalog, effortKeyFor };
