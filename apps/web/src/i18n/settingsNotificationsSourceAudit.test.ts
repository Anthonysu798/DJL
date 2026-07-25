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
const DIRECTORIES = ["components/settings", "components/profile", "notifications", "whatsNew"];
const EXPLICIT_FILES = [
  "routes/_chat.settings.tsx",
  "components/RateLimitsPanel.tsx",
  "components/WhatsNewDialog.tsx",
  "components/ReleaseHistoryDialog.tsx",
  "components/ProviderUsageLimitRows.tsx",
  "components/ProviderUsageMenuControl.tsx",
  "components/ProviderUsagePanelContent.tsx",
  "components/RateLimitSummaryList.tsx",
  "lib/providerUsageDisplay.ts",
  "lib/rateLimits.ts",
  "lib/usagePace.ts",
] as const;
const VISIBLE_NAMES =
  /(?:ariaLabel|children|description|detail|emptyLabel|emptyMessage|heading|label|loadingLabel|message|placeholder|reason|resetLabel|status|summary|text|title|tooltip)$/i;
const VISIBLE_ATTRIBUTES = new Set([
  "alt",
  "aria-label",
  "description",
  "label",
  "placeholder",
  "title",
  "tooltip",
]);
const UI_CALL = /(?:alert|confirm|notify|set[A-Za-z]*Error|showToast|toast)$/;

// Exact whole-value technical identifiers that intentionally remain authored as-is.
const TECHNICAL_ALLOWLIST = new Set([
  "DJL",
  "CODEX_HOME",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GEMINI_API_KEY",
  "GROK_API_KEY",
  "KILO_API_KEY",
  "Codex",
  "Claude",
  "Cursor",
  "Gemini",
  "Grok",
  "Droid",
  "Kilo",
  "Pi",
  "X",
  "LinkedIn",
  "Reddit",
  "Ollama",
  "LM Studio",
]);

function scopedFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return scopedFiles(path);
    if (![".ts", ".tsx"].includes(extname(entry.name))) return [];
    if (/\.(?:test|browser)\.[^.]+$/.test(entry.name)) return [];
    // Historical release bodies intentionally stay English and are localized only when current.
    if (path.endsWith(join("whatsNew", "entries.ts"))) return [];
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

function substantialEnglish(value: string): boolean {
  const text = value.replace(/\s+/g, " ").trim();
  if (!/[A-Za-z]{2,}/.test(text)) return false;
  if (TECHNICAL_ALLOWLIST.has(text)) return false;
  if (/^[A-Z0-9_./:@{}\[\]-]{2,}$/.test(text)) return false;
  if (/^(?:https?:\/\/|\/|\.|@)/.test(text)) return false;
  return text.includes(" ") || /^[A-Z][a-z]{2,}$/.test(text);
}

export function collectSettingsNotificationsEnglish(
  source: string,
  fileName = "fixture.tsx",
): Finding[] {
  const file = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const bindings = new Map<string, ts.Expression>();
  const findings: Finding[] = [];

  const bind = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      bindings.set(node.name.text, node.initializer);
    }
    ts.forEachChild(node, bind);
  };
  bind(file);

  const add = (node: ts.Node, literal: string | null) => {
    if (!literal || !substantialEnglish(literal)) return;
    findings.push({
      line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1,
      literal: literal.replace(/\s+/g, " ").trim(),
    });
  };

  const expression = (node: ts.Expression, seen = new Set<string>()): void => {
    const literal = literalText(node);
    if (literal !== null) {
      add(node, literal);
      if (ts.isTemplateExpression(node)) {
        for (const span of node.templateSpans) expression(span.expression, seen);
      }
      return;
    }
    if (ts.isIdentifier(node)) {
      if (seen.has(node.text)) return;
      const value = bindings.get(node.text);
      if (value) expression(value, new Set([...seen, node.text]));
      return;
    }
    if (ts.isConditionalExpression(node)) {
      expression(node.whenTrue, seen);
      expression(node.whenFalse, seen);
      return;
    }
    if (ts.isBinaryExpression(node)) {
      if (
        [
          ts.SyntaxKind.QuestionQuestionToken,
          ts.SyntaxKind.BarBarToken,
          ts.SyntaxKind.AmpersandAmpersandToken,
          ts.SyntaxKind.PlusToken,
        ].includes(node.operatorToken.kind)
      ) {
        expression(node.left, seen);
        expression(node.right, seen);
      }
      return;
    }
    if (ts.isArrayLiteralExpression(node)) {
      for (const item of node.elements)
        expression(ts.isSpreadElement(item) ? item.expression : item, seen);
      return;
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      if (["filter", "flatMap", "join", "map"].includes(node.expression.name.text)) {
        expression(node.expression.expression, seen);
        for (const arg of node.arguments) {
          if (ts.isArrowFunction(arg) || ts.isFunctionExpression(arg)) {
            if (ts.isBlock(arg.body)) {
              for (const statement of arg.body.statements) {
                if (ts.isReturnStatement(statement) && statement.expression)
                  expression(statement.expression, seen);
              }
            } else expression(arg.body, seen);
          }
        }
      }
      return;
    }
    if (ts.isNewExpression(node)) {
      for (const argument of node.arguments ?? []) expression(argument, seen);
      return;
    }
    if (
      ts.isParenthesizedExpression(node) ||
      ts.isAsExpression(node) ||
      ts.isSatisfiesExpression(node) ||
      ts.isNonNullExpression(node) ||
      ts.isAwaitExpression(node)
    ) {
      expression(node.expression, seen);
    }
  };

  const visit = (node: ts.Node): void => {
    if (ts.isJsxText(node)) add(node, node.text);
    if (
      ts.isJsxAttribute(node) &&
      ts.isIdentifier(node.name) &&
      VISIBLE_ATTRIBUTES.has(node.name.text) &&
      node.initializer
    ) {
      if (ts.isStringLiteral(node.initializer)) add(node.initializer, node.initializer.text);
      if (ts.isJsxExpression(node.initializer) && node.initializer.expression)
        expression(node.initializer.expression);
    }
    if (ts.isJsxExpression(node) && !ts.isJsxAttribute(node.parent) && node.expression)
      expression(node.expression);
    if (ts.isPropertyAssignment(node)) {
      const name =
        ts.isIdentifier(node.name) || ts.isStringLiteral(node.name) ? node.name.text : "";
      if (VISIBLE_NAMES.test(name)) expression(node.initializer);
    }
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      VISIBLE_NAMES.test(node.name.text)
    )
      expression(node.initializer);
    if (ts.isCallExpression(node) && UI_CALL.test(node.expression.getText(file))) {
      for (const arg of node.arguments) expression(arg);
    }
    if (ts.isThrowStatement(node) && node.expression) expression(node.expression);
    ts.forEachChild(node, visit);
  };
  visit(file);
  return findings;
}

describe("settings/notifications source audit classifier", () => {
  it.each([
    ["JSX", `<p>Unable to load settings</p>`],
    ["visible prop", `<Card description="No models are configured" />`],
    ["module metadata", `const item = { label: "Local models" };`],
    ["toast", `toast({ title: "Update failed" })`],
    ["conditional", `const title = ok ? "Update complete" : "Update failed"; toast({ title })`],
    ["template", "toast({ title: `Could not update ${provider}` })"],
    ["nullish", `const detail = raw ?? "No details available"; <Card detail={detail} />`],
    ["binary", `const message = "Repair failed" + raw; alert(message)`],
    [
      "join",
      `const lines = ["Delete this worktree", "This cannot be undone"]; confirm(lines.join("\\n"))`,
    ],
    ["identifier", `const emptyMessage = "No archived threads"; <Empty message={emptyMessage} />`],
    ["cross component", `const model = { summary: "Provider is unavailable" }; <Row {...model} />`],
    ["throw", `throw new Error("Could not export profile image")`],
  ])("detects %s flow", (_name, source) => {
    expect(collectSettingsNotificationsEnglish(source).length).toBeGreaterThan(0);
  });
});

describe("settings/notifications production source audit", () => {
  const findingsFor = (files: readonly string[]) =>
    files.flatMap((path) =>
      collectSettingsNotificationsEnglish(readFileSync(path, "utf8"), path).map(
        (finding) => `${relative(ROOT, path)}:${finding.line}: ${finding.literal}`,
      ),
    );

  it("contains no ordinary authored English UI copy outside the settings route", () => {
    const files = [
      ...DIRECTORIES.flatMap((directory) => scopedFiles(join(ROOT, directory))),
      ...EXPLICIT_FILES.filter((file) => file !== "routes/_chat.settings.tsx").map((file) =>
        join(ROOT, file),
      ),
    ];
    expect(findingsFor(files)).toEqual([]);
  });

  it("contains no ordinary authored English UI copy in the settings route", () => {
    const files = [join(ROOT, "routes/_chat.settings.tsx")];
    expect(findingsFor(files)).toEqual([]);
  });
});
