// FILE: branding.source-audit.test.ts
// Purpose: Prevents the legacy product name from returning in user-facing web or desktop copy.
// Layer: Cross-surface source audit

import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(import.meta.dirname, "../../..");
const SOURCE_ROOTS = ["apps/web/src", "apps/desktop/src", "apps/desktop/scripts"] as const;
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs"]);

function collectSourceFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(path));
    } else if (
      SOURCE_EXTENSIONS.has(extname(entry.name)) &&
      !entry.name.includes(".test.") &&
      !entry.name.includes(".spec.") &&
      !entry.name.includes(".browser.")
    ) {
      files.push(path);
    }
  }
  return files;
}

function isAllowedCompatibilityLiteral(value: string): boolean {
  return (
    /@synara|\.synara|synara:\/\/|SYNARA_|com\.emanueledipietro\.synara/.test(value) ||
    /\/Applications\/Synara/.test(value) ||
    value.includes("(DJL|Synara)") ||
    value === "Synara browser" ||
    value.startsWith("[Synara browser]") ||
    value.startsWith("SynaraVoice-")
  );
}

function legacyBrandLiterals(path: string): string[] {
  const sourceText = readFileSync(path, "utf8");
  const sourceFile = ts.createSourceFile(
    path,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    path.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const violations: string[] = [];

  function visit(node: ts.Node): void {
    if (
      ts.isStringLiteralLike(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node) ||
      ts.isJsxText(node)
    ) {
      const value = node.text;
      if (value.includes("Synara") && !isAllowedCompatibilityLiteral(value)) {
        const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
        violations.push(`${relative(REPO_ROOT, path)}:${line}: ${value.trim()}`);
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return violations;
}

describe("DJL source branding", () => {
  it("keeps the legacy product name out of user-facing app and desktop literals", () => {
    const violations = SOURCE_ROOTS.flatMap((root) =>
      collectSourceFiles(resolve(REPO_ROOT, root)).flatMap(legacyBrandLiterals),
    );

    const indexHtml = readFileSync(resolve(REPO_ROOT, "apps/web/index.html"), "utf8");
    if (
      indexHtml.includes("<title>Synara</title>") ||
      indexHtml.includes("synara-logo.svg") ||
      indexHtml.includes("app-boot-splash")
    ) {
      violations.push("apps/web/index.html: legacy title or branded boot splash");
    }

    expect(violations).toEqual([]);
  }, 15_000);
});
