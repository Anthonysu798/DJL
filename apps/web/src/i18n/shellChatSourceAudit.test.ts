import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

interface Finding {
  line: number;
  literal: string;
}

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const CHAT_ROOT = join(ROOT, "components/chat");
const EXPLICIT_FILES = [
  "components/ChatView.tsx",
  "components/RenameDialog.tsx",
  "components/RenameThreadDialog.tsx",
  "components/ShortcutsDialog.tsx",
  "components/Sidebar.tsx",
  "components/SidebarHeaderNavigationControls.tsx",
  "components/SidebarSearchPalette.tsx",
  "components/SplashScreen.tsx",
  "components/ThreadWorktreeHandoffDialog.tsx",
  "routes/__root.tsx",
  "routes/_chat.tsx",
  "routes/_chat.$threadId.tsx",
  "shortcutsSheet.ts",
] as const;

const VISIBLE_ATTRIBUTE_NAMES = new Set([
  "alt",
  "aria-label",
  "description",
  "emptyLabel",
  "label",
  "placeholder",
  "removeLabel",
  "text",
  "title",
  "tooltip",
]);
const VISIBLE_PROPERTY_NAMES = new Set([
  "ariaLabel",
  "children",
  "description",
  "detail",
  "emptyLabel",
  "emptyMessage",
  "heading",
  "label",
  "loadingLabel",
  "message",
  "placeholder",
  "projectName",
  "projectRemoteName",
  "reason",
  "removeLabel",
  "summary",
  "text",
  "title",
  "tooltip",
]);
const VISIBLE_NAME_PATTERN =
  /(?:ariaLabel|children|description|detail|emptyLabel|emptyMessage|heading|label|loadingLabel|message|placeholder|projectName|projectRemoteName|reason|removeLabel|summary|text|title|tooltip)$/i;
const UI_CALL_PATTERN = /(?:alert|confirm|notify|set[A-Za-z]*Error|showToast|toast)$/;

// Only product names, identifiers, paths, command examples, and raw protocol text belong here.
const NONTRANSLATABLE_BY_FILE = new Set(["components/Sidebar.tsx:e.g. npm run dev"]);

function activeChatFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return activeChatFiles(path);
    if (![".ts", ".tsx"].includes(extname(entry.name))) return [];
    if (/\.(?:test|browser)\.[^.]+$/.test(entry.name)) return [];
    return [path];
  });
}

function literalText(node: ts.Node): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) {
    return [node.head.text, ...node.templateSpans.map((span) => `{…}${span.literal.text}`)].join(
      "",
    );
  }
  return null;
}

function propertyName(node: ts.PropertyName): string | null {
  if (ts.isIdentifier(node) || ts.isStringLiteral(node)) return node.text;
  return null;
}

function substantialEnglish(value: string): boolean {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!/[A-Za-z]{2,}/.test(normalized)) return false;
  if (normalized === "Aa") return false;
  if (/^[A-Z0-9]{2,6}$/.test(normalized)) return false;
  if (!normalized.includes(" ") && /[-_./:@\[\]{}]/.test(normalized)) return false;
  return true;
}

export function collectVisibleEnglishLiterals(source: string, fileName = "fixture.tsx"): Finding[] {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const findings: Finding[] = [];
  const bindings = new Map<string, ts.Expression>();

  function collectBindings(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      bindings.set(node.name.text, node.initializer);
    }
    ts.forEachChild(node, collectBindings);
  }

  collectBindings(sourceFile);

  function add(node: ts.Node, literal: string | null) {
    if (!literal || !substantialEnglish(literal)) return;
    findings.push({
      line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
      literal: literal.replace(/\s+/g, " ").trim(),
    });
  }

  function addExpression(node: ts.Expression, seenBindings = new Set<string>()) {
    const literal = literalText(node);
    if (literal !== null) {
      add(node, literal);
      if (ts.isTemplateExpression(node)) {
        for (const span of node.templateSpans) addExpression(span.expression, seenBindings);
      }
      return;
    }

    if (ts.isIdentifier(node)) {
      if (seenBindings.has(node.text)) return;
      const initializer = bindings.get(node.text);
      if (!initializer) return;
      addExpression(initializer, new Set([...seenBindings, node.text]));
      return;
    }

    if (ts.isConditionalExpression(node)) {
      addExpression(node.whenTrue, seenBindings);
      addExpression(node.whenFalse, seenBindings);
      return;
    }

    if (ts.isBinaryExpression(node)) {
      const operator = node.operatorToken.kind;
      if (
        operator === ts.SyntaxKind.QuestionQuestionToken ||
        operator === ts.SyntaxKind.BarBarToken ||
        operator === ts.SyntaxKind.AmpersandAmpersandToken ||
        operator === ts.SyntaxKind.PlusToken
      ) {
        addExpression(node.left, seenBindings);
        addExpression(node.right, seenBindings);
      }
      return;
    }

    if (ts.isArrayLiteralExpression(node)) {
      for (const element of node.elements) {
        if (ts.isSpreadElement(element)) addExpression(element.expression, seenBindings);
        else addExpression(element, seenBindings);
      }
      return;
    }

    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text;
      if (["filter", "flatMap", "join", "map"].includes(method)) {
        addExpression(node.expression.expression, seenBindings);
        for (const argument of node.arguments) {
          if (ts.isArrowFunction(argument) || ts.isFunctionExpression(argument)) {
            if (ts.isBlock(argument.body)) {
              for (const statement of argument.body.statements) {
                if (ts.isReturnStatement(statement) && statement.expression) {
                  addExpression(statement.expression, seenBindings);
                }
              }
            } else {
              addExpression(argument.body, seenBindings);
            }
          }
        }
      }
      return;
    }

    if (
      ts.isParenthesizedExpression(node) ||
      ts.isAsExpression(node) ||
      ts.isNonNullExpression(node) ||
      ts.isSatisfiesExpression(node) ||
      ts.isAwaitExpression(node)
    ) {
      addExpression(node.expression, seenBindings);
    }
  }

  function visit(node: ts.Node) {
    if (ts.isJsxText(node)) add(node, node.text);

    if (
      ts.isJsxAttribute(node) &&
      ts.isIdentifier(node.name) &&
      VISIBLE_ATTRIBUTE_NAMES.has(node.name.text)
    ) {
      if (node.initializer && ts.isStringLiteral(node.initializer))
        add(node.initializer, node.initializer.text);
      if (node.initializer && ts.isJsxExpression(node.initializer) && node.initializer.expression) {
        addExpression(node.initializer.expression);
      }
    }

    if (ts.isJsxExpression(node) && !ts.isJsxAttribute(node.parent) && node.expression) {
      addExpression(node.expression);
    }

    if (ts.isPropertyAssignment(node)) {
      const name = propertyName(node.name);
      if (name && (VISIBLE_PROPERTY_NAMES.has(name) || VISIBLE_NAME_PATTERN.test(name))) {
        addExpression(node.initializer);
      }
    }

    if (ts.isShorthandPropertyAssignment(node) && VISIBLE_NAME_PATTERN.test(node.name.text)) {
      addExpression(node.name);
    }

    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      if (VISIBLE_NAME_PATTERN.test(node.name.text)) addExpression(node.initializer);
    }

    if (ts.isFunctionDeclaration(node) && node.name && VISIBLE_NAME_PATTERN.test(node.name.text)) {
      for (const descendant of node.body?.statements ?? []) {
        if (ts.isReturnStatement(descendant) && descendant.expression) {
          addExpression(descendant.expression);
        }
      }
    }

    if (ts.isCallExpression(node)) {
      const callee = node.expression.getText(sourceFile);
      if (UI_CALL_PATTERN.test(callee)) {
        for (const argument of node.arguments) addExpression(argument);
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return findings;
}

describe("shell/chat localized source audit classifier", () => {
  it.each([
    ["direct JSX", `<span>Source</span>`, "Source"],
    ["visible prop", `<PreviewCard title="Preview" />`, "Preview"],
    ["module metadata", `export const meta = { label: "Source" };`, "Source"],
    ["toast object", `toast({ title: "Unable to open project" });`, "Unable to open project"],
    ["named label", `const previewLabel = "Preview";`, "Preview"],
  ])("detects %s English", (_name, source, expected) => {
    expect(collectVisibleEnglishLiterals(source).map((finding) => finding.literal)).toContain(
      expected,
    );
  });

  it.each([
    [
      "conditional branches",
      `const title = failed ? "Provider updates failed" : "Some provider updates failed"; toast({ title });`,
      ["Provider updates failed", "Some provider updates failed"],
    ],
    [
      "nullish fallbacks",
      `const description = error ?? "Old chats will be retried later"; <Notice description={description} />;`,
      ["Old chats will be retried later"],
    ],
    [
      "joined arrays through variables",
      `const lines = ["Undo the latest file changes", "This action cannot be undone"]; const message = lines.join("\\n"); confirm(message);`,
      ["Undo the latest file changes", "This action cannot be undone"],
    ],
  ])("detects English in %s", (_name, source, expected) => {
    expect(collectVisibleEnglishLiterals(source).map((finding) => finding.literal)).toEqual(
      expect.arrayContaining(expected),
    );
  });

  it("detects English carried through cross-component visible model fields", () => {
    const source = `
      const thread = {
        projectName: project?.name ?? "Unknown project",
        projectRemoteName: project?.remoteName ?? "Unknown remote project",
      };
      <SidebarSearchPalette threads={[thread]} />;
    `;

    expect(collectVisibleEnglishLiterals(source).map((finding) => finding.literal)).toEqual(
      expect.arrayContaining(["Unknown project", "Unknown remote project"]),
    );
  });
});

describe("shell/chat localization dependencies", () => {
  it("recomputes renderDockPane when the locale changes", () => {
    const path = join(ROOT, "routes/_chat.$threadId.tsx");
    const source = readFileSync(path, "utf8");
    const sourceFile = ts.createSourceFile(
      path,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    let dependencies: string[] | null = null;

    function visit(node: ts.Node) {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text === "renderDockPane" &&
        node.initializer &&
        ts.isCallExpression(node.initializer)
      ) {
        const dependencyArray = node.initializer.arguments[1];
        if (dependencyArray && ts.isArrayLiteralExpression(dependencyArray)) {
          dependencies = dependencyArray.elements.map((element) => element.getText(sourceFile));
        }
      }
      ts.forEachChild(node, visit);
    }

    visit(sourceFile);
    expect(dependencies).toContain("t");
  });
});

describe("shell/chat localized production source", () => {
  it("contains no unclassified active English UI copy", () => {
    const files = [
      ...activeChatFiles(CHAT_ROOT),
      ...EXPLICIT_FILES.map((path) => join(ROOT, path)),
    ].toSorted();
    const unexpected = files.flatMap((path) => {
      const relativePath = relative(ROOT, path);
      return collectVisibleEnglishLiterals(readFileSync(path, "utf8"), path)
        .filter(({ literal }) => !NONTRANSLATABLE_BY_FILE.has(`${relativePath}:${literal}`))
        .map(({ line, literal }) => `${relativePath}:${line}: ${literal}`);
    });
    expect(unexpected).toEqual([]);
  });
});
