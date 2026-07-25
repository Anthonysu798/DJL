import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

interface Finding {
  line: number;
  literal: string;
}

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const WORKSPACE_FILES = [
  "components/WorkspaceView.tsx",
  "components/EditorWorkspaceView.tsx",
  "components/BrowserAnnotationEditor.tsx",
  "components/BrowserPanel.tsx",
  "components/BranchToolbar.tsx",
  "components/BranchToolbarBranchSelector.tsx",
  "components/GitActionsControl.tsx",
  "components/DiffPanel.tsx",
  "components/DiffPanelFileJumpMenu.tsx",
  "components/DiffPanelFileList.tsx",
  "components/DiffPanelPatchViewport.tsx",
  "components/DiffPanelShell.tsx",
  "components/DiffPanelToolbar.tsx",
  "components/ReviewFileTreePanel.tsx",
  "components/WorkspaceSettingsSheet.tsx",
  "components/ProjectScriptsControl.tsx",
  "components/ThreadTerminalDrawer.tsx",
  "components/TerminalWorkspaceTabs.tsx",
  "components/TerminalSearch.tsx",
  "components/TerminalScrollToBottom.tsx",
  "components/terminal/TerminalActivityIndicator.tsx",
  "components/terminal/TerminalChrome.tsx",
  "components/terminal/TerminalIdentityIcon.tsx",
  "components/terminal/TerminalViewportPane.tsx",
  "components/PullRequestThreadDialog.tsx",
  "components/WorkspaceFilePreview.tsx",
  "components/chat/WorkspaceFilePreviewHeader.tsx",
  "components/PdfFilePreview.tsx",
  "components/PresentationFilePreview.tsx",
  "components/LocalImagePreview.tsx",
  "components/pdf/PdfPageView.tsx",
  "components/pdf/PdfViewerToolbar.tsx",
  "components/work/NativeDocumentPreview.tsx",
  "hooks/useTerminalSurfaceController.ts",
  "lib/terminalCloseConfirmation.ts",
  "lib/fileReferenceContextMenu.ts",
  "lib/chatReferences.ts",
  "lib/pdf/pdfEngine.ts",
  "lib/pdf/pdfLinks.ts",
  "lib/pdf/pdfZoom.ts",
  "lib/pdf/pdfUiError.ts",
  "lib/pdf/useContainerSize.ts",
  "lib/pdf/usePdfDocument.ts",
  "lib/pdf/usePdfPageNavigation.ts",
  "lib/pdf/usePdfPageRender.ts",
  "lib/pdf/usePdfSearch.ts",
  "lib/pdf/usePdfViewerActions.ts",
  "lib/pdf/usePdfZoomController.ts",
] as const;

const VISIBLE_NAMES =
  /(?:alt|ariaLabel|children|description|detail|emptyLabel|emptyMessage|error|heading|label|loadingLabel|message|placeholder|reason|removeLabel|status|summary|text|title|tooltip)$/i;
const UI_CALL_PATTERN = /(?:alert|confirm|notify|set[A-Za-z]*Error|showToast|toast)$/;
const UI_HELPER_RETURN_FILE_PATTERN =
  /(?:terminalCloseConfirmation|fileReferenceContextMenu|chatReferences|usePdfDocument|usePdfPageRender|usePdfViewerActions)\.ts$/;

// Genuine product/technical invariants only. Ordinary UI copy is never allowlisted.
const NONTRANSLATABLE_BY_FILE = new Set([
  "components/ProjectScriptsControl.tsx:play",
  "components/ProjectScriptsControl.tsx:test",
  "components/ProjectScriptsControl.tsx:lint",
  "components/ProjectScriptsControl.tsx:configure",
  "components/ProjectScriptsControl.tsx:build",
  "components/ProjectScriptsControl.tsx:debug",
  "components/ProjectScriptsControl.tsx:bun test",
  "components/PullRequestThreadDialog.tsx:https://github.com/owner/repo/pull/42 or #42",
  "components/DiffPanelToolbar.tsx:stacked",
  "components/DiffPanelToolbar.tsx:split",
  // CSS adjustment examples are user-editable technical values, not interface prose.
  "components/BrowserAnnotationEditor.tsx:#ffffff",
  "components/BrowserAnnotationEditor.tsx:Inter, sans-serif",
  "components/BrowserAnnotationEditor.tsx:16px",
  "components/BrowserAnnotationEditor.tsx:left",
  "components/BrowserAnnotationEditor.tsx:8px 0",
  "components/BrowserAnnotationEditor.tsx:12px 16px",
  "components/BrowserAnnotationEditor.tsx:8px",
  // Browser runtime protocol states must remain byte-for-byte stable.
  "components/BrowserPanel.tsx:suspended",
  "components/BrowserPanel.tsx:live",
  // PDF hook state-machine identifiers are protocol values, not rendered copy.
  "lib/pdf/usePdfDocument.ts:loading",
  "lib/pdf/usePdfDocument.ts:ready",
  "lib/pdf/usePdfDocument.ts:error",
]);

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
  return ts.isIdentifier(node) || ts.isStringLiteral(node) ? node.text : null;
}

function substantialEnglish(value: string): boolean {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!/[A-Za-z]{2,}/.test(normalized)) return false;
  if (normalized === "Aa") return false;
  if (/^[A-Z0-9]{2,6}$/.test(normalized)) return false;
  if (!normalized.includes(" ") && /[-_./:@\[\]{}]/.test(normalized)) return false;
  return true;
}

export function collectWorkspaceVisibleEnglish(
  source: string,
  fileName = "fixture.tsx",
): Finding[] {
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

  function add(node: ts.Node, value: string | null) {
    if (!value || !substantialEnglish(value)) return;
    findings.push({
      line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
      literal: value.replace(/\s+/g, " ").trim(),
    });
  }

  function addExpression(node: ts.Expression, seen = new Set<string>()) {
    const literal = literalText(node);
    if (literal !== null) {
      add(node, literal);
      if (ts.isTemplateExpression(node)) {
        for (const span of node.templateSpans) addExpression(span.expression, seen);
      }
      return;
    }
    if (ts.isIdentifier(node)) {
      if (seen.has(node.text)) return;
      const initializer = bindings.get(node.text);
      if (initializer) addExpression(initializer, new Set([...seen, node.text]));
      return;
    }
    if (ts.isConditionalExpression(node)) {
      addExpression(node.whenTrue, seen);
      addExpression(node.whenFalse, seen);
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
        addExpression(node.left, seen);
        addExpression(node.right, seen);
      }
      return;
    }
    if (ts.isArrayLiteralExpression(node)) {
      for (const element of node.elements) {
        addExpression(ts.isSpreadElement(element) ? element.expression : element, seen);
      }
      return;
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      if (["filter", "flatMap", "join", "map"].includes(node.expression.name.text)) {
        addExpression(node.expression.expression, seen);
        for (const argument of node.arguments) {
          if (ts.isArrowFunction(argument) || ts.isFunctionExpression(argument)) {
            if (ts.isBlock(argument.body)) {
              for (const statement of argument.body.statements) {
                if (ts.isReturnStatement(statement) && statement.expression) {
                  addExpression(statement.expression, seen);
                }
              }
            } else addExpression(argument.body, seen);
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
      addExpression(node.expression, seen);
    }
  }

  function visit(node: ts.Node) {
    if (ts.isJsxText(node)) add(node, node.text);
    if (
      ts.isJsxAttribute(node) &&
      ts.isIdentifier(node.name) &&
      VISIBLE_NAMES.test(node.name.text)
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
      if (name && VISIBLE_NAMES.test(name)) addExpression(node.initializer);
    }
    if (ts.isShorthandPropertyAssignment(node) && VISIBLE_NAMES.test(node.name.text)) {
      addExpression(node.name);
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      if (VISIBLE_NAMES.test(node.name.text)) addExpression(node.initializer);
    }
    if (ts.isCallExpression(node) && UI_CALL_PATTERN.test(node.expression.getText(sourceFile))) {
      for (const argument of node.arguments) addExpression(argument);
    }
    if (
      ts.isReturnStatement(node) &&
      node.expression &&
      UI_HELPER_RETURN_FILE_PATTERN.test(fileName)
    ) {
      addExpression(node.expression);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return findings;
}

describe("workspace localization source audit classifier", () => {
  it.each([
    ["direct JSX", `<span>Source control</span>`, "Source control"],
    ["visible prop", `<Panel title="File preview" />`, "File preview"],
    ["module metadata", `export const meta = { label: "Open terminal" };`, "Open terminal"],
    ["toast", `toast({ title: "Unable to open file" });`, "Unable to open file"],
  ])("detects %s", (_name, source, expected) => {
    expect(collectWorkspaceVisibleEnglish(source).map(({ literal }) => literal)).toContain(
      expected,
    );
  });

  it("detects user-facing copy returned by audited UI helpers", () => {
    const source = `export function buildPrompt() { return "Why did this file change?"; }`;
    expect(
      collectWorkspaceVisibleEnglish(source, "chatReferences.ts").map(({ literal }) => literal),
    ).toContain("Why did this file change?");
  });

  it("detects conditionals, nullish values, binary text, joins, identifiers, and cross-component fields", () => {
    const source = `
      const labels = ["Open changes", "Close changes"];
      const title = failed ? "Diff failed" : "Diff ready";
      const detail = reason ?? "Try opening the file again";
      const message = "Selected " + "workspace files";
      const emptyLabel = labels.join(" / ");
      const model = { title, detail, message, emptyLabel };
      <WorkspaceCard {...model} />;
    `;
    expect(collectWorkspaceVisibleEnglish(source).map(({ literal }) => literal)).toEqual(
      expect.arrayContaining([
        "Open changes",
        "Close changes",
        "Diff failed",
        "Diff ready",
        "Try opening the file again",
        "Selected",
        "workspace files",
      ]),
    );
  });
});

describe("workspace localized production source", () => {
  it("contains no unclassified active English UI copy", () => {
    const unexpected = WORKSPACE_FILES.map((file) => join(ROOT, file)).flatMap((path) => {
      const relativePath = relative(ROOT, path);
      return collectWorkspaceVisibleEnglish(readFileSync(path, "utf8"), path)
        .filter(({ literal }) => !NONTRANSLATABLE_BY_FILE.has(`${relativePath}:${literal}`))
        .map(({ line, literal }) => `${relativePath}:${line}: ${literal}`);
    });
    expect(unexpected).toEqual([]);
  });
});
