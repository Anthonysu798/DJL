import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";

describe("document tool startup dependencies", () => {
  it("loads Office and PDF engines only when their operations are requested", () => {
    const source = readFileSync(new URL("./documentTools.ts", import.meta.url), "utf8");
    for (const dependency of ["docx", "exceljs", "pdf-lib", "pptxgenjs"]) {
      expect(
        new RegExp(`^import (?!type).*from "${dependency}"`, "m").test(source),
        dependency,
      ).toBe(false);
      expect(source.includes(`import("${dependency}")`), dependency).toBe(true);
    }
  });
});

it("keeps Claude SDK initialization off the backend import path", () => {
  for (const relativePath of [
    "../harnesses/native/claude.ts",
    "../provider/Layers/ProviderHealth.ts",
    "../orchestration/importThreadRoute.ts",
  ]) {
    const source = readFileSync(new URL(relativePath, import.meta.url), "utf8");
    const ast = ts.createSourceFile(relativePath, source, ts.ScriptTarget.Latest, true);
    const eagerSdkImports = ast.statements.filter(
      (node) =>
        ts.isImportDeclaration(node) &&
        ts.isStringLiteral(node.moduleSpecifier) &&
        node.moduleSpecifier.text === "@anthropic-ai/claude-agent-sdk" &&
        !node.importClause?.isTypeOnly,
    );
    expect(eagerSdkImports.length, relativePath).toBe(0);
  }
});
