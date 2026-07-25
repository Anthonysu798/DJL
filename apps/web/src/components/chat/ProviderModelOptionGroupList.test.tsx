import { createInstance, type i18n } from "i18next";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { beforeAll, describe, expect, it, vi } from "vitest";

import englishCatalog from "../../i18n/locales/en.json";
import { Menu, MenuRadioGroup } from "../ui/menu";
import { ProviderModelOptionGroupList } from "./ProviderModelOptionGroupList";

let testI18n: i18n;

beforeAll(async () => {
  testI18n = createInstance();
  await testI18n.use(initReactI18next).init({ lng: "en", resources: { en: englishCatalog } });
});

describe("ProviderModelOptionGroupList", () => {
  it("omits locality labels so model names can use the full row width", () => {
    const markup = renderToStaticMarkup(
      <I18nextProvider i18n={testI18n}>
        <Menu open>
          <MenuRadioGroup value="deepseek-chat">
            <ProviderModelOptionGroupList
              groupedOptions={[
                {
                  key: "all",
                  label: null,
                  options: [
                    {
                      slug: "deepseek-chat",
                      name: "DeepSeek Chat with a Long Model Name",
                      processingLocality: "remote",
                    },
                    {
                      slug: "gpt-oss-20b",
                      name: "GPT OSS 20B with a Long Model Name",
                      processingLocality: "local",
                    },
                  ],
                },
              ]}
              provider="opencode"
              activeModel="deepseek-chat"
              isSearching={false}
              favoriteProvider="opencode"
              favoriteModelSlugSet={new Set()}
              onToggleFavorite={vi.fn()}
            />
          </MenuRadioGroup>
        </Menu>
      </I18nextProvider>,
    );

    expect(markup).toContain("DeepSeek Chat with a Long Model Name");
    expect(markup).toContain("GPT OSS 20B with a Long Model Name");
    expect(markup).not.toContain("Cloud");
    expect(markup).not.toContain("On device");
  });
});
