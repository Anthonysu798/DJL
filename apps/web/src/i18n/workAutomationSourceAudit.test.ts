import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

import { collectWorkspaceVisibleEnglish } from "./workspaceSourceAudit.test";

interface Finding {
  readonly file: string;
  readonly line: number;
  readonly literal: string;
}

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SCOPED_DIRECTORIES = ["components/work", "components/kanban"] as const;
const SCOPED_ROUTE_PATTERN =
  /^routes\/(?:-automations\.shared|_chat\.(?:work|kanban|studio|automations)(?:\.|$))/;
const SCOPED_HELPER_PATTERN =
  /^(?:lib\/(?:automation|kanban|studio)[^/]*|hooks\/useHandleNewStudioChat)\.(?:ts|tsx)$/;
const TEST_FILE_PATTERN = /(?:\.test\.|\.browser\.|\.spec\.)/;
const HELPER_UI_PATTERN =
  /^(?:lib\/(?:automation|kanban|studio)|hooks\/useHandleNewStudioChat|components\/work\/workTaskPresentation|routes\/-automations\.shared)/;
const UI_FIELD_PATTERN =
  /(?:description|detail|emptyLabel|error|heading|label|message|name|placeholder|reason|status|summary|text|title|tooltip)$/i;

// Exact technical/protocol values only. Ordinary UI copy is never allowlisted.
const NONTRANSLATABLE = new Set([
  "lib/automationForm.ts:UTC",
  "components/work/WorkTaskPanel.tsx:pending",
  "components/kanban/KanbanView.tsx:Ctrl+Alt+T",
  "lib/automationForm.ts:daily",
  "lib/automationForm.ts:weekdays",
  "lib/automationForm.ts:weekly",
  "lib/automationForm.ts:manual",
  "lib/automationForm.ts:once",
  "lib/automationForm.ts:cron",
  "lib/automationForm.ts:hourly",
  "lib/automationForm.ts:custom",
  "lib/automationIntent.ts:create an automation",
  "lib/automationIntent.ts:thread",
  "lib/automationIntent.ts:worktree",
  "lib/automationIntent.ts:standalone",
  "lib/automationCompletionPolicy.ts:heartbeat",
  "lib/automationStatus.ts:scheduled",
  "lib/automationStatus.ts:done",
  "lib/automationStatus.ts:active",
  "lib/automationStatus.ts:paused",
  "lib/kanbanDispatch.ts:empty",
  "routes/-automations.shared.tsx:auto",
  "routes/-automations.shared.tsx:worktree",
  "routes/-automations.shared.tsx:local",
  "routes/-automations.shared.tsx:success",
  "routes/-automations.shared.tsx:error",
  "routes/-automations.shared.tsx:warning",
  "routes/-automations.shared.tsx:info",
  "routes/_chat.automations.index.tsx:unread",
  "routes/_chat.automations.index.tsx:all",
]);

function productionFiles(): string[] {
  const files: string[] = [];
  const walk = (directory: string) => {
    for (const entry of readdirSync(join(ROOT, directory), { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.tsx?$/.test(entry.name) && !TEST_FILE_PATTERN.test(entry.name)) files.push(path);
    }
  };
  for (const directory of SCOPED_DIRECTORIES) walk(directory);
  walk("hooks");
  walk("routes");
  walk("lib");
  return [...new Set(files)].filter(
    (file) =>
      SCOPED_DIRECTORIES.some((directory) => file.startsWith(`${directory}/`)) ||
      SCOPED_ROUTE_PATTERN.test(file) ||
      SCOPED_HELPER_PATTERN.test(file),
  );
}

function helperFindings(source: string, fileName: string): Omit<Finding, "file">[] {
  if (!HELPER_UI_PATTERN.test(fileName)) return [];
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const findings: Omit<Finding, "file">[] = [];
  const add = (node: ts.Node, value: string) => {
    const literal = value.replace(/\s+/g, " ").trim();
    if (!/[A-Za-z]{2,}/.test(literal) || /^[A-Z0-9]{2,6}$/.test(literal)) return;
    if (!literal.includes(" ") && /[-_./:@\[\]{}]/.test(literal)) return;
    findings.push({
      line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
      literal,
    });
  };
  const visit = (node: ts.Node) => {
    const addExpression = (expression: ts.Expression): void => {
      if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
        add(expression, expression.text);
      } else if (ts.isTemplateExpression(expression)) {
        add(
          expression,
          [expression.head.text, ...expression.templateSpans.map((span) => span.literal.text)].join(
            " ",
          ),
        );
      } else if (ts.isConditionalExpression(expression)) {
        addExpression(expression.whenTrue);
        addExpression(expression.whenFalse);
      }
    };
    if (
      ts.isPropertyAssignment(node) &&
      (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) &&
      UI_FIELD_PATTERN.test(node.name.text) &&
      (ts.isStringLiteral(node.initializer) || ts.isNoSubstitutionTemplateLiteral(node.initializer))
    ) {
      add(node.initializer, node.initializer.text);
    }
    if (ts.isReturnStatement(node) && node.expression) addExpression(node.expression);
    if (
      ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "Error"
    ) {
      const message = node.arguments?.[0];
      if (message) addExpression(message);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return findings;
}

export function collectWorkAutomationVisibleEnglish(
  source: string,
  fileName = "fixture.tsx",
): Omit<Finding, "file">[] {
  const base = collectWorkspaceVisibleEnglish(source, fileName);
  const helpers = helperFindings(source, fileName);
  return [...base, ...helpers].filter(
    (finding, index, all) =>
      all.findIndex(
        (candidate) => candidate.line === finding.line && candidate.literal === finding.literal,
      ) === index,
  );
}

describe("Work, Kanban, Studio, and automation localization source audit classifier", () => {
  it.each([
    ["JSX", `<h2>Automation history</h2>`, "Automation history"],
    ["visible prop", `<Panel aria-label="Task progress" />`, "Task progress"],
    ["module metadata", `export const meta = { label: "New automation" };`, "New automation"],
    ["toast", `toast({ title: "Could not start task" });`, "Could not start task"],
    ["conditional", `<span>{ok ? "Task complete" : "Task failed"}</span>`, "Task complete"],
    ["nullish", `<span>{title ?? "Unknown project"}</span>`, "Unknown project"],
    ["binary", `<span>{"Open " + fileName}</span>`, "Open"],
    ["join", `<span>{["Run now", suffix].join(" · ")}</span>`, "Run now"],
    ["identifier", `const label = "Needs review"; <span>{label}</span>`, "Needs review"],
    [
      "cross-component model field",
      `const card = { title: "Saved automation" }; <AutomationCard {...card} />`,
      "Saved automation",
    ],
  ])("detects %s", (_name, source, expected) => {
    expect(collectWorkAutomationVisibleEnglish(source).map((finding) => finding.literal)).toContain(
      expected,
    );
  });

  it("detects UI strings returned by active helper models", () => {
    expect(
      collectWorkAutomationVisibleEnglish(
        `export function label() { return "Not scheduled"; }`,
        "lib/automationForm.ts",
      ).map((finding) => finding.literal),
    ).toContain("Not scheduled");
  });

  it.each([
    [
      "template return",
      "lib/automationForm.ts",
      "export function label(value: string) { return `Once ${value}`; }",
      "Once",
    ],
    [
      "conditional helper",
      "lib/automationForm.ts",
      "export function label(ok: boolean) { return ok ? 'Run now' : 'Try later'; }",
      "Run now",
    ],
    [
      "authored thrown error",
      "lib/studioProjects.ts",
      "throw new Error('Work is still syncing. Try again.');",
      "Work is still syncing. Try again.",
    ],
  ])("detects %s", (_name, file, source, expected) => {
    expect(
      collectWorkAutomationVisibleEnglish(source, file).map((finding) => finding.literal),
    ).toContain(expected);
  });

  it("finds no ordinary English UI copy in the active production scope", () => {
    const findings = productionFiles().flatMap((file) => {
      const source = readFileSync(join(ROOT, file), "utf8");
      return collectWorkAutomationVisibleEnglish(source, file)
        .filter((finding) => !NONTRANSLATABLE.has(`${file}:${finding.literal}`))
        .map((finding) => ({ file, ...finding }));
    });
    const byArea = findings.reduce<Record<string, number>>((counts, finding) => {
      const area = finding.file.split("/").slice(0, 2).join("/");
      counts[area] = (counts[area] ?? 0) + 1;
      return counts;
    }, {});
    expect(
      findings,
      JSON.stringify(
        {
          count: findings.length,
          byArea,
          sample: findings.slice(0, 30),
        },
        null,
        2,
      ),
    ).toEqual([]);
  });

  it("enumerates the bounded production scope recursively", () => {
    const files = productionFiles().map((file) => relative(ROOT, join(ROOT, file)));
    expect(files).toContain("components/work/WorkTaskPanel.tsx");
    expect(files).toContain("components/kanban/KanbanNewTaskDialog.tsx");
    expect(files).toContain("routes/-automations.shared.tsx");
    expect(files).toContain("routes/_chat.studio.index.tsx");
    expect(files).toContain("lib/automationDraft.ts");
    expect(files).toContain("hooks/useHandleNewStudioChat.ts");
  });

  it("does not fall back to an implicit locale in cited date-time formatters", () => {
    const files = [
      "components/work/WorkTaskPanel.tsx",
      "lib/automationForm.ts",
      "lib/automationIntent.ts",
      "routes/_chat.automations.$automationId.tsx",
    ];
    const source = files.map((file) => readFileSync(join(ROOT, file), "utf8")).join("\n");
    expect(source).not.toMatch(/Intl\.DateTimeFormat\(undefined/);
    expect(source).not.toMatch(/\.toLocaleString\(\)/);
    expect(source).not.toMatch(/\.toLocaleTimeString\(\[\]/);
    expect(source).not.toMatch(/new Intl\.(?:DateTimeFormat|NumberFormat|RelativeTimeFormat)/);
    expect(source.match(/Intl\.DateTimeFormat\(\)\.resolvedOptions\(\)\.timeZone/g)).toHaveLength(
      2,
    );
  });
});
