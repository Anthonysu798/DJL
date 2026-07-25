import { describe, expect, it } from "vitest";
import { createDesktopI18n } from "./desktopI18n";
import { buildDisabledUpdatesDialog, buildUpdateResultDialog } from "./desktopDialogs";

describe("localized update dialog presentation", () => {
  it("localizes authored copy while preserving raw diagnostics verbatim", async () => {
    const runtime = await createDesktopI18n("ja", []);
    expect(buildDisabledUpdatesDialog(runtime.t, "RAW provider diagnostic")).toEqual(
      expect.objectContaining({
        title: "アップデートを利用できません",
        detail: "RAW provider diagnostic",
        buttons: ["OK"],
      }),
    );

    expect(
      buildUpdateResultDialog(
        runtime.t,
        {
          status: "error",
          message: "RAW updater failure",
        } as never,
        "DJL",
      ),
    ).toEqual(
      expect.objectContaining({
        title: "アップデートの確認に失敗しました",
        detail: "RAW updater failure",
      }),
    );
  });
});
