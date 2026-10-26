import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { expect, it } from "vitest";
import { catalogs } from "./index";

it("keeps visible static admin copy in catalogs, with explicit protocol and brand exceptions", () => {
  const files: string[] = [];
  const collect = (dir: string) => {
    for (const item of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, item.name);
      if (item.isDirectory()) collect(path);
      else if (path.endsWith(".tsx") && !path.includes(".test.")) files.push(path);
    }
  };
  collect("app");
  collect("components");
  const exceptions = new Set([
    "DJL",
    "DJL Admin",
    "CPU",
    "OpenRouter",
    "OpenAI API",
    "Anthropic API",
    "RESET",
    "Ada Lovelace",
    "ada@slcor.com",
    "203.0.113.0/24\n2001:db8::1",
    "198.51.100.7",
  ]);
  const attributes = new Set([
    "label",
    "title",
    "subtitle",
    "description",
    "placeholder",
    "hint",
    "confirmLabel",
    "aria-label",
    "alt",
  ]);
  const failures: string[] = [];
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const visit = (node: ts.Node) => {
      let value: string | undefined;
      if (ts.isJsxText(node)) value = node.getText(ast).replace(/\s+/g, " ").trim();
      else if (
        ts.isStringLiteral(node) &&
        ts.isJsxAttribute(node.parent) &&
        attributes.has(node.parent.name.getText(ast))
      )
        value = node.text;
      else if (
        ts.isStringLiteral(node) &&
        ts.isPropertyAssignment(node.parent) &&
        attributes.has(node.parent.name.getText(ast))
      )
        value = node.text;
      if (
        value &&
        /[A-Za-z]{2}/.test(value) &&
        !Object.hasOwn(catalogs.en, value) &&
        !exceptions.has(value)
      )
        failures.push(
          `${file}:${ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1} ${value}`,
        );
      ts.forEachChild(node, visit);
    };
    visit(ast);
  }
  expect(failures).toEqual([]);
});
