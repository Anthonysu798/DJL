import i18next from "i18next";
import { renderToStaticMarkup } from "react-dom/server";
import { initReactI18next } from "react-i18next";
import { beforeAll, describe, expect, it } from "vitest";
import englishCatalog from "../../i18n/locales/en.json";

import { ComposerImageAttachmentChip } from "./ComposerImageAttachmentChip";

beforeAll(async () => {
  await i18next.use(initReactI18next).init({ lng: "en", resources: { en: englishCatalog } });
});

describe("ComposerImageAttachmentChip", () => {
  it("renders a compact thumbnail with preview and remove actions", () => {
    const markup = renderToStaticMarkup(
      <ComposerImageAttachmentChip
        image={{
          id: "image-1",
          type: "image",
          name: "CleanShot 2026-04-11 at 20.00.33@2x.png",
          mimeType: "image/png",
          sizeBytes: 1024,
          previewUrl: "blob:image-1",
          file: new File(["image"], "CleanShot 2026-04-11 at 20.00.33@2x.png", {
            type: "image/png",
          }),
        }}
        images={[
          {
            id: "image-1",
            type: "image",
            name: "CleanShot 2026-04-11 at 20.00.33@2x.png",
            mimeType: "image/png",
            sizeBytes: 1024,
            previewUrl: "blob:image-1",
            file: new File(["image"], "CleanShot 2026-04-11 at 20.00.33@2x.png", {
              type: "image/png",
            }),
          },
        ]}
        nonPersisted={false}
        onExpandImage={() => {}}
        onRemoveImage={() => {}}
      />,
    );

    expect(markup).toContain("CleanShot 2026-04-11 at 20.00.33@2x.png");
    expect(markup).toContain("size-16");
    expect(markup).toContain("Preview CleanShot 2026-04-11 at 20.00.33@2x.png");
    expect(markup).toContain("Remove CleanShot 2026-04-11 at 20.00.33@2x.png");
    expect(markup).not.toContain("h-14 w-14");
  });
});
