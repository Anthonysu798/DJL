import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import ts from "typescript";

export interface VisibleEnglishFinding {
  readonly line: number;
  readonly literal: string;
}

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

const VISIBLE_NAME_SUFFIXES = [
  "alt",
  "ariaLabel",
  "caption",
  "description",
  "emptyLabel",
  "emptyMessage",
  "fallbackTitle",
  "heading",
  "label",
  "loadingLabel",
  "localOptionLabel",
  "message",
  "placeholder",
  "reason",
  "removeLabel",
  "shortLabel",
  "summary",
  "title",
  "tooltip",
  "unavailableMessage",
  "worktreeBadgeLabel",
  "worktreeOptionLabel",
] as const;
const VISIBLE_ATTRIBUTE = new Set([
  "alt",
  "aria-label",
  "description",
  "label",
  "placeholder",
  "title",
  "tooltip",
]);
const UI_CALL = /(?:alert|confirm|notify|set[A-Za-z]*Error|showToast|toast)$/;
const TECHNICAL_EXACT = new Set([
  "DJL",
  "Codex",
  "Claude",
  "Cursor",
  "Gemini",
  "Grok",
  "Droid",
  "Kilo",
  "OpenCode",
  "Pi",
  "Ollama",
  "LM Studio",
  "Git",
  "GitHub",
  "JSON",
  "Markdown",
  "PDF",
  "HTML",
  "CSS",
  "JavaScript",
  "TypeScript",
  "macOS",
  "Windows",
  "Linux",
  "DJL Desktop",
  "Reddit",
  "JetBrains Mono",
  '"JetBrains Mono"',
]);
const THEME_NAME_EXACT = new Set([
  "Absolutely",
  "Ayu",
  "Catppuccin",
  "Dracula",
  "Everforest",
  "Gruvbox",
  "Linear",
  "Lobster",
  "Material",
  "Matrix",
  "Monokai",
  "Night Owl",
  "Nord",
  "Notion",
  "One",
  "Oscurange",
  "Proof",
  "Raycast",
  "Rose Pine",
  "Sentry",
  "Solarized",
  "Temple",
  "Tokyo Night",
  "Vercel",
  "VS Code Plus",
]);
const DEV_ONLY_SOURCE_FILE_SUFFIXES = [
  "apps/web/src/components/DebugFeatureFlagsMenu.tsx",
  "apps/web/src/components/GitProgressToastPreviewToggle.tsx",
  "apps/web/src/components/useGitProgressToastPreview.ts",
] as const;

function isVisibleName(name: string): boolean {
  return VISIBLE_NAME_SUFFIXES.some((suffix) => {
    if (name.toLowerCase() === suffix.toLowerCase()) return true;
    const capitalized = `${suffix[0]!.toUpperCase()}${suffix.slice(1)}`;
    return name.endsWith(capitalized);
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

function isTechnicalContainer(node: ts.Node): boolean {
  for (let current: ts.Node | undefined = node.parent; current; current = current.parent) {
    if (ts.isJsxElement(current)) {
      const tag = current.openingElement.tagName.getText().toLowerCase();
      if (tag === "style") return true;
    }
  }
  return false;
}

function isThemeMetadataLabel(node: ts.Node, value: string, fileName: string): boolean {
  if (!fileName.endsWith("theme/theme.logic.ts") || !THEME_NAME_EXACT.has(value)) return false;
  return (
    ts.isStringLiteral(node) &&
    ts.isPropertyAssignment(node.parent) &&
    (ts.isIdentifier(node.parent.name) || ts.isStringLiteral(node.parent.name)) &&
    node.parent.name.text === "label"
  );
}

function isNativeLocaleMetadataLabel(node: ts.Node, value: string, fileName: string): boolean {
  return (
    fileName.endsWith("i18n/appLocaleOptions.ts") &&
    ["English", "Español (Latinoamérica)"].includes(value) &&
    ts.isStringLiteral(node) &&
    ts.isPropertyAssignment(node.parent) &&
    (ts.isIdentifier(node.parent.name) || ts.isStringLiteral(node.parent.name)) &&
    node.parent.name.text === "nativeLabel"
  );
}

function isFeatureFlagDebugMetadata(node: ts.Node, fileName: string): boolean {
  if (!fileName.endsWith("apps/web/src/featureFlags.ts") || !ts.isStringLiteral(node)) return false;
  const property = node.parent;
  if (!ts.isPropertyAssignment(property)) return false;
  const name =
    ts.isIdentifier(property.name) || ts.isStringLiteral(property.name) ? property.name.text : "";
  if (name !== "label" && name !== "description") return false;
  for (let current: ts.Node | undefined = property.parent; current; current = current.parent) {
    if (ts.isVariableDeclaration(current) && ts.isIdentifier(current.name)) {
      return current.name.text === "FEATURE_FLAGS";
    }
    if (ts.isSourceFile(current)) break;
  }
  return false;
}

function isInternalErrorConstruction(node: ts.Node): boolean {
  for (let current: ts.Node | undefined = node.parent; current; current = current.parent) {
    if (ts.isNewExpression(current)) {
      const constructorName = current.expression.getText();
      return constructorName === "WsTransportRpcError";
    }
    if (ts.isStatement(current)) return false;
  }
  return false;
}

function substantialAuthoredEnglish(value: string, node: ts.Node, fileName: string): boolean {
  const text = value.replace(/\s+/g, " ").trim();
  if (
    !/[A-Za-z]{2,}/.test(text) ||
    TECHNICAL_EXACT.has(text) ||
    isThemeMetadataLabel(node, text, fileName) ||
    isNativeLocaleMetadataLabel(node, text, fileName) ||
    isFeatureFlagDebugMetadata(node, fileName) ||
    isInternalErrorConstruction(node)
  )
    return false;
  if (/^(?:https?:\/\/|file:\/\/|\/|~\/|\.\.?\/|[A-Za-z]:\\)/.test(text)) return false;
  if (/^(?:[\w.-]+\/)+[\w.-]+$/.test(text)) return false;
  if (/^(?:bun|npm|pnpm|yarn|git|codex|claude|node)\s+[-\w]/i.test(text)) return false;
  if (/^[a-z0-9]+(?:[-_.:/][a-z0-9]+)+$/i.test(text)) return false;
  if (/^[A-Z0-9_./:@{}\[\]-]{2,}$/.test(text)) return false;
  if (/^(?:[a-z]+:)?\/\//i.test(text)) return false;
  if (
    /^(?:(?:text|font|bg|flex|grid|items|justify|gap|leading|tracking|rounded|border|shadow|space|p[trblxy]?|m[trblxy]?|w|h|min-w|max-w|min-h|max-h|overflow|opacity|tabular|whitespace)-[^\s]+\s*){2,}$/i.test(
      text,
    )
  )
    return false;
  if (/^(?:-?\d+(?:\.\d+)?(?:px|rem|em|%)?)(?:\s+-?\d+(?:\.\d+)?(?:px|rem|em|%)?)*$/i.test(text))
    return false;
  if (/^["']?[\w -]+["']?,\s*(?:sans-serif|serif|monospace)$/i.test(text)) return false;
  if (/^code=\{…}|^signal=\{…}|^request-error:/i.test(text)) return false;
  return text.includes(" ") || /^[A-Z][a-z]{2,}$/.test(text);
}

export function collectVisibleEnglish(
  source: string,
  fileName = "fixture.tsx",
): VisibleEnglishFinding[] {
  const file = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const bindings = new Map<string, ts.Expression>();
  const findings: VisibleEnglishFinding[] = [];

  const collectBindings = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      bindings.set(node.name.text, node.initializer);
    }
    ts.forEachChild(node, collectBindings);
  };
  collectBindings(file);

  const add = (node: ts.Node, value: string | null): void => {
    if (!value || isTechnicalContainer(node) || !substantialAuthoredEnglish(value, node, fileName))
      return;
    const finding = {
      line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1,
      literal: value.replace(/\s+/g, " ").trim(),
    };
    if (
      !findings.some(
        (candidate) => candidate.line === finding.line && candidate.literal === finding.literal,
      )
    ) {
      findings.push(finding);
    }
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
      const initializer = bindings.get(node.text);
      if (initializer) expression(initializer, new Set([...seen, node.text]));
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
      (VISIBLE_ATTRIBUTE.has(node.name.text) || isVisibleName(node.name.text)) &&
      node.initializer
    ) {
      if (ts.isStringLiteral(node.initializer)) add(node.initializer, node.initializer.text);
      if (ts.isJsxExpression(node.initializer) && node.initializer.expression) {
        expression(node.initializer.expression);
      }
    }
    if (ts.isJsxExpression(node) && !ts.isJsxAttribute(node.parent) && node.expression) {
      expression(node.expression);
    }
    if (ts.isPropertyAssignment(node)) {
      const name =
        ts.isIdentifier(node.name) || ts.isStringLiteral(node.name) ? node.name.text : "";
      if (isVisibleName(name)) expression(node.initializer);
    }
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      isVisibleName(node.name.text)
    ) {
      expression(node.initializer);
    }
    if (ts.isCallExpression(node) && UI_CALL.test(node.expression.getText(file))) {
      for (const argument of node.arguments) expression(argument);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return findings;
}

function flatten(value: JsonValue, path: readonly string[] = []): Map<string, JsonValue> {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return new Map(
      Object.entries(value).flatMap(([key, child]) => [...flatten(child, [...path, key])]),
    );
  }
  return new Map([[path.join("."), value]]);
}

function rendererCopyCatalogPath(key: string): string | null {
  const separator = key.indexOf(":");
  if (separator <= 0 || separator === key.length - 1) return null;
  return `${key.slice(0, separator)}.${key.slice(separator + 1)}`;
}

/** Validates statically-authored renderer translation keys against the source catalog. */
export function validateRendererCopyKeys(
  source: string,
  catalog: JsonValue,
  fileName = "fixture.ts",
): string[] {
  const file = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const leaves = flatten(catalog);
  const errors: string[] = [];
  const hasCatalogKey = (path: string): boolean =>
    leaves.has(path) ||
    [...leaves.keys()].some((candidate) => {
      const match = PLURAL_SUFFIX.exec(candidate);
      return match !== null && candidate.slice(0, -match[0].length) === path;
    });
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(file) === "translateRendererCopy" &&
      node.arguments.length > 0
    ) {
      const keyNode = node.arguments[0]!;
      if (ts.isStringLiteral(keyNode) || ts.isNoSubstitutionTemplateLiteral(keyNode)) {
        const path = rendererCopyCatalogPath(keyNode.text);
        const line = file.getLineAndCharacterOfPosition(keyNode.getStart(file)).line + 1;
        if (!path)
          errors.push(
            `${fileName}:${line}: renderer key must include a namespace: ${keyNode.text}`,
          );
        else if (!hasCatalogKey(path))
          errors.push(`${fileName}:${line}: missing renderer catalog key ${keyNode.text}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return errors;
}

function valueType(value: JsonValue): string {
  return Array.isArray(value) ? "array" : value === null ? "null" : typeof value;
}

function placeholders(value: JsonValue): string[] {
  if (typeof value !== "string") return [];
  return [...value.matchAll(/{{\s*([^},\s]+)[^}]*}}/g)].map((match) => match[1]!).toSorted();
}

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

export function validateCatalogs(catalogs: Record<string, JsonValue>): string[] {
  const locales = Object.keys(catalogs);
  const sourceLocale = locales.includes("en") ? "en" : locales[0];
  if (!sourceLocale) return ["No catalogs found."];
  const source = flatten(catalogs[sourceLocale]!);
  const errors: string[] = [];
  for (const locale of locales) {
    if (locale === sourceLocale) continue;
    const candidate = flatten(catalogs[locale]!);
    for (const [key, sourceValue] of source) {
      if (!candidate.has(key)) {
        errors.push(`${locale}: missing key ${key}`);
        continue;
      }
      const candidateValue = candidate.get(key)!;
      if (valueType(candidateValue) !== valueType(sourceValue)) {
        errors.push(`${locale}:${key}: value type differs`);
      }
      if (placeholders(candidateValue).join("|") !== placeholders(sourceValue).join("|")) {
        errors.push(`${locale}:${key}: interpolation placeholder parity differs`);
      }
    }
    for (const key of candidate.keys()) {
      if (!source.has(key)) errors.push(`${locale}: extra key ${key}`);
    }
    const pluralShape = (leaves: Map<string, JsonValue>) => {
      const groups = new Map<string, string[]>();
      for (const key of leaves.keys()) {
        const match = PLURAL_SUFFIX.exec(key);
        if (!match) continue;
        const base = key.slice(0, -match[0].length);
        groups.set(base, [...(groups.get(base) ?? []), match[1]!].toSorted());
      }
      return groups;
    };
    const sourcePlurals = pluralShape(source);
    const candidatePlurals = pluralShape(candidate);
    for (const [base, suffixes] of sourcePlurals) {
      if ((candidatePlurals.get(base) ?? []).join("|") !== suffixes.join("|")) {
        errors.push(`${locale}:${base}: plural category parity differs`);
      }
    }
  }
  return errors;
}

function canonicalize(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right, "en"))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

export function canonicalCatalogJson(value: JsonValue): string {
  return `${JSON.stringify(canonicalize(value), null, 2)}\n`;
}

export function validateLocaleReviewStatus(
  locales: readonly string[],
  status: Record<string, unknown>,
): string[] {
  const errors: string[] = [];
  for (const locale of locales) {
    const value = status[locale];
    if (locale === "en") {
      if (value !== "approved") errors.push("en: review status must be approved");
    } else if (value !== "approved" && value !== "draft") {
      errors.push(`${locale}: review status must be approved or draft`);
    }
  }
  for (const locale of Object.keys(status)) {
    if (!locales.includes(locale)) errors.push(`${locale}: review status has no catalog`);
  }
  return errors;
}

export function isProductionSourceFile(path: string): boolean {
  const normalized = path.replaceAll("\\", "/");
  if (/(?:\.test\.|\.browser\.|\.spec\.|\.gen\.)/.test(normalized)) return false;
  // These modules are reachable only behind import.meta.env.DEV; their authored
  // fixture copy previews failure states and is deliberately absent from release bundles.
  if (DEV_ONLY_SOURCE_FILE_SUFFIXES.some((suffix) => normalized.endsWith(suffix))) return false;
  return [".ts", ".tsx"].includes(extname(normalized));
}

function productionSourceFiles(root: string): string[] {
  const roots = [join(root, "apps/web/src"), join(root, "apps/desktop/src")];
  const files: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (!isProductionSourceFile(path)) continue;
      else files.push(path);
    }
  };
  for (const directory of roots) walk(directory);
  return files;
}

export interface RepositoryI18nCheckResult {
  readonly errors: readonly string[];
  readonly catalogLeaves: number;
  readonly visibleEnglishFindings: number;
}

export function checkRepositoryI18n(
  root = resolve(import.meta.dirname, "../.."),
): RepositoryI18nCheckResult {
  const localeDirectories = [
    join(root, "apps/web/src/i18n/locales"),
    join(root, "apps/desktop/src/locales"),
  ];
  const errors: string[] = [];
  let catalogLeaves = 0;
  let webLocales: string[] = [];
  let webEnglishCatalog: JsonValue = {};
  for (const [index, directory] of localeDirectories.entries()) {
    const files = readdirSync(directory)
      .filter((file) => file.endsWith(".json"))
      .toSorted();
    const catalogs: Record<string, JsonValue> = {};
    for (const file of files) {
      const path = join(directory, file);
      const raw = readFileSync(path, "utf8");
      const catalog = JSON.parse(raw) as JsonValue;
      const locale = file.slice(0, -5);
      catalogs[locale] = catalog;
      if (raw !== canonicalCatalogJson(catalog))
        errors.push(`${relative(root, path)}: keys are not canonically ordered`);
    }
    errors.push(
      ...validateCatalogs(catalogs).map((error) => `${relative(root, directory)}: ${error}`),
    );
    if (index === 0) {
      webLocales = Object.keys(catalogs);
      webEnglishCatalog = catalogs.en!;
      catalogLeaves = flatten(catalogs.en!).size;
    }
  }
  const reviewPath = join(root, "packages/shared/src/localeReviewStatus.json");
  const reviewStatus = JSON.parse(readFileSync(reviewPath, "utf8")) as Record<string, unknown>;
  errors.push(...validateLocaleReviewStatus(webLocales, reviewStatus));
  if (readFileSync(reviewPath, "utf8") !== canonicalCatalogJson(reviewStatus as JsonValue)) {
    errors.push(`${relative(root, reviewPath)}: keys are not canonically ordered`);
  }

  let visibleEnglishFindings = 0;
  for (const path of productionSourceFiles(root)) {
    const source = readFileSync(path, "utf8");
    errors.push(...validateRendererCopyKeys(source, webEnglishCatalog, relative(root, path)));
    for (const finding of collectVisibleEnglish(source, path)) {
      visibleEnglishFindings += 1;
      errors.push(`${relative(root, path)}:${finding.line}: visible English: ${finding.literal}`);
    }
  }
  return { errors, catalogLeaves, visibleEnglishFindings };
}
