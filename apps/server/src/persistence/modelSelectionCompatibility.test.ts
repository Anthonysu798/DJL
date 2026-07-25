// FILE: modelSelectionCompatibility.test.ts
// Purpose: Protects provider inference and option normalization for persisted model selections.
// Layer: Persistence compatibility tests
// Depends on: modelSelectionCompatibility.

import { assert, it } from "@effect/vitest";

import { normalizePersistedModelSelection } from "./modelSelectionCompatibility.ts";

it("preserves canonical Pi model selections", () => {
  assert.deepEqual(normalizePersistedModelSelection({ provider: "pi", model: "openai/gpt-5.5" }), {
    provider: "pi",
    model: "openai/gpt-5.5",
  });
});

it("infers Pi from persisted instance labels", () => {
  assert.deepEqual(
    normalizePersistedModelSelection({
      instanceId: "local-pi-runtime-instance",
      model: "openai/gpt-5.5",
    }),
    {
      provider: "pi",
      model: "openai/gpt-5.5",
    },
  );
});

it("infers Droid only for Factory-exclusive provider-less model slugs", () => {
  assert.deepEqual(normalizePersistedModelSelection({ model: "minimax-m3" }), {
    provider: "droid",
    model: "minimax-m3",
  });
});

it("does not steal ambiguous provider-less Claude slugs from Claude Agent", () => {
  assert.deepEqual(normalizePersistedModelSelection({ model: "claude-opus-4-8" }), {
    provider: "claudeAgent",
    model: "claude-opus-4-8",
  });
});

it("canonicalizes deprecated official DeepSeek OpenCode selections without losing options", () => {
  assert.deepEqual(
    normalizePersistedModelSelection({
      provider: "opencode",
      model: "deepseek/deepseek-reasoner",
      options: { agent: "build" },
    }),
    {
      provider: "opencode",
      model: "deepseek/deepseek-v4-flash",
      options: { agent: "build" },
    },
  );
  assert.deepEqual(
    normalizePersistedModelSelection({
      provider: "opencode",
      model: "deepseek/deepseek-chat",
    }),
    {
      provider: "opencode",
      model: "deepseek/deepseek-v4-flash",
    },
  );
});
