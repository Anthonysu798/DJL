import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createInstance } from "i18next";
import { initReactI18next } from "react-i18next";
import { beforeAll, describe, expect, it } from "vitest";

import * as GitActionsControl from "../components/GitActionsControl";
import {
  formatDirtyWorktreeDescription,
  resolveGitIndexLockPath,
} from "../components/BranchToolbarBranchSelector";
import * as PdfViewerActions from "../lib/pdf/usePdfViewerActions";
import englishCatalog from "./locales/en.json";

const SRC = fileURLToPath(new URL("..", import.meta.url));
const source = (path: string) => readFileSync(join(SRC, path), "utf8");
const i18n = createInstance();

beforeAll(async () => {
  await i18n.use(initReactI18next).init({
    defaultNS: "workspace",
    fallbackLng: "en",
    interpolation: { escapeValue: false },
    lng: "en",
    resources: { en: englishCatalog },
  });
});

describe("workspace review interpolation regressions", () => {
  it("resolves branch labels without leaking templates and preserves exact Git paths", () => {
    const t = i18n.getFixedT("en", "workspace");
    expect(t("branch.continueIn")).not.toContain("{{");
    expect(t("branch.rateLimitsRemaining", { percent: "73%" })).toContain("73%");
    expect(t("branch.errors.dirtyFiles", { count: 1, files: "src/exact-name.ts" })).toContain(
      "src/exact-name.ts",
    );
    expect(
      t("branch.errors.dirtyMany", {
        count: 2,
        files: "src/first.ts, packages/exact-second.ts",
      }),
    ).toContain("packages/exact-second.ts");
    expect(t("branch.errors.indexLockedDescription", { path: "/repo/.git/index.lock" })).toContain(
      "/repo/.git/index.lock",
    );
  });

  it("passes branch interpolation data at the active call sites", () => {
    const toolbar = source("components/BranchToolbar.tsx");
    const selector = source("components/BranchToolbarBranchSelector.tsx");
    expect(toolbar).toMatch(/branch\.rateLimitsRemaining[\s\S]{0,100}percent/);
    expect(selector).not.toContain('.split("/").slice(-2)');
  });

  it("preserves exact dirty filenames and index-lock paths through production helpers", () => {
    const t = i18n.getFixedT("en", "workspace");
    const files = ["src/exact-name.ts", "packages/ui/exact component.tsx"];
    const description = formatDirtyWorktreeDescription(t, files);
    expect(description).toContain(files[0]);
    expect(description).toContain(files[1]);

    const lockPath = "/repo with spaces/.git/index.lock";
    expect(resolveGitIndexLockPath(new Error(`Unable to create '${lockPath}': File exists`))).toBe(
      lockPath,
    );
  });
});

describe("semantic PDF and Git presentation state", () => {
  it("translates an ongoing Git phase at render time from raw semantic values", () => {
    const resolve = (GitActionsControl as Record<string, unknown>)["resolveGitProgressPhaseLabel"];
    expect(resolve).toBeTypeOf("function");
    const phase = { id: "runningHook", name: "pre-commit" };
    expect((resolve as Function)((key: string) => `en:${key}`, phase)).toBe(
      "en:git.progress.runningHook",
    );
    expect((resolve as Function)((key: string) => `fr:${key}`, phase)).toBe(
      "fr:git.progress.runningHook",
    );
  });

  it("keeps PDF upstream details raw while translating the summary on demand", () => {
    const createError = (PdfViewerActions as Record<string, unknown>)["createPdfUiError"];
    const resolveSummary = (PdfViewerActions as Record<string, unknown>)[
      "resolvePdfUiErrorSummary"
    ];
    expect(createError).toBeTypeOf("function");
    expect(resolveSummary).toBeTypeOf("function");
    const error = (createError as Function)(
      "preview.errors.print",
      new Error("renderer: exact failure 0xCAFE"),
    );
    expect(error.detail).toBe("renderer: exact failure 0xCAFE");
    expect((resolveSummary as Function)((key: string) => `fr:${key}`, error)).toBe(
      "fr:preview.errors.print",
    );
  });

  it("does not carry a print failure from one preview URL into the next document", () => {
    const resolvePrintError = (PdfViewerActions as Record<string, unknown>)[
      "resolvePdfPrintErrorForPreview"
    ];
    expect(resolvePrintError).toBeTypeOf("function");
    const error = { summaryKey: "preview.errors.print", detail: "document A failed" };
    const failedState = { previewUrl: "/preview/a.pdf", error };
    expect((resolvePrintError as Function)(failedState, "/preview/a.pdf")).toBe(error);
    expect((resolvePrintError as Function)(failedState, "/preview/b.pdf")).toBeNull();
  });

  it("does not swallow PDF print failures at preview call sites", () => {
    expect(source("components/PdfFilePreview.tsx")).not.toContain(
      "actions.print().catch(() => undefined)",
    );
    expect(source("components/PresentationFilePreview.tsx")).not.toContain(
      "actions.print().catch(() => undefined)",
    );
  });
});
