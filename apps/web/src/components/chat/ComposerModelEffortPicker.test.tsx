import type { ModelSlug, ProviderKind, ThreadId } from "@synara/contracts";
import { createInstance, type i18n } from "i18next";
import { type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { beforeAll, describe, expect, it, vi } from "vitest";

import englishCatalog from "../../i18n/locales/en.json";
import type { ProviderModelOption } from "../../providerModelOptions";
import { ComposerModelEffortPicker } from "./ComposerModelEffortPicker";
import { ProviderModelPicker } from "./ProviderModelPicker";

let testI18n: i18n;

beforeAll(async () => {
  testI18n = createInstance();
  await testI18n.use(initReactI18next).init({ lng: "en", resources: { en: englishCatalog } });
});

function renderPicker(element: ReactElement) {
  return renderToStaticMarkup(<I18nextProvider i18n={testI18n}>{element}</I18nextProvider>);
}

describe("ComposerModelEffortPicker", () => {
  it("shows the selected model without a provider icon", () => {
    const model = "gpt-5.6" as ModelSlug;
    const modelOptionsByProvider = Object.fromEntries(
      ["codex", "claudeAgent", "cursor", "gemini", "grok", "droid", "kilo", "opencode", "pi"].map(
        (provider) => [provider, []],
      ),
    ) as unknown as Record<ProviderKind, ReadonlyArray<ProviderModelOption>>;
    modelOptionsByProvider.codex = [{ slug: model, name: "GPT-5.6" }];

    const markup = renderPicker(
      <ComposerModelEffortPicker
        provider="codex"
        model={model}
        lockedProvider={null}
        modelOptionsByProvider={modelOptionsByProvider}
        threadId={"thread-test" as ThreadId}
        modelOptions={undefined}
        prompt=""
        onPromptChange={vi.fn()}
        onProviderModelChange={vi.fn()}
      />,
    );

    expect(markup).toContain("GPT-5.6");
    expect(markup.match(/<svg/g)).toHaveLength(1);
  });

  it("keeps the standalone model trigger free of provider icons", () => {
    const model = "gpt-5.6" as ModelSlug;
    const modelOptionsByProvider = Object.fromEntries(
      ["codex", "claudeAgent", "cursor", "gemini", "grok", "droid", "kilo", "opencode", "pi"].map(
        (provider) => [provider, []],
      ),
    ) as unknown as Record<ProviderKind, ReadonlyArray<ProviderModelOption>>;
    modelOptionsByProvider.codex = [{ slug: model, name: "GPT-5.6" }];

    const markup = renderPicker(
      <ProviderModelPicker
        provider="codex"
        model={model}
        lockedProvider={null}
        modelOptionsByProvider={modelOptionsByProvider}
        onProviderModelChange={vi.fn()}
      />,
    );

    expect(markup).toContain("GPT-5.6");
    expect(markup.match(/<svg/g)).toHaveLength(1);
  });
});
