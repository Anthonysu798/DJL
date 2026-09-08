import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { expect, it } from "vitest";

it("the dev icon entry covers every runtime icon import in the app", () => {
  const entry = ts.createSourceFile(
    "icons.mjs",
    readFileSync(path.resolve(import.meta.dirname, "../dev/icons.mjs"), "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const exports = new Set(
    entry.statements.flatMap((statement) =>
      ts.isExportDeclaration(statement) &&
      statement.exportClause &&
      ts.isNamedExports(statement.exportClause)
        ? statement.exportClause.elements.map((specifier) => specifier.name.text)
        : [],
    ),
  );
  const missing: string[] = [];
  function visit(directory: string) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(filename);
        continue;
      }
      if (!/\.[jt]sx?$/.test(filename)) continue;
      const text = readFileSync(filename, "utf8");
      if (!/react-icons\/|@tabler\/icons-react/.test(text)) continue;
      const source = ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true);
      for (const statement of source.statements) {
        if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier))
          continue;
        if (!/^(react-icons\/|@tabler\/icons-react$)/.test(statement.moduleSpecifier.text))
          continue;
        const clause = statement.importClause;
        if (!clause || clause.isTypeOnly) continue;
        const bindings = clause.namedBindings;
        expect(bindings && ts.isNamedImports(bindings), filename).toBe(true);
        if (!bindings || !ts.isNamedImports(bindings)) continue;
        for (const specifier of bindings.elements) {
          if (specifier.isTypeOnly) continue;
          const name = (specifier.propertyName ?? specifier.name).text;
          if (!exports.has(name)) missing.push(`${filename}: ${name}`);
        }
      }
    }
  }
  visit(path.resolve(import.meta.dirname));
  expect(missing, "Add these imports to dev/icons.mjs").toEqual([]);
});
