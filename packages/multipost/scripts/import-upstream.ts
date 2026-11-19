/** Reproducible DJL adaptation; upstream originals remain in vendor/. */
import ts from "typescript";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
const root = resolve(import.meta.dirname, "..");
const parse = (file: string) =>
  ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
const printer = ts.createPrinter();
function browserSource(file: string) {
  const source = parse(file);
  let exported = "";
  let deferred = 0;
  const asyncNames = new Set<string>();
  const collectAsync = (node: ts.Node) => {
    if (
      ts.isFunctionDeclaration(node) &&
      node.name &&
      node.modifiers?.some((mod) => mod.kind === ts.SyntaxKind.AsyncKeyword)
    )
      asyncNames.add(node.name.text);
    ts.forEachChild(node, collectAsync);
  };
  collectAsync(source);
  const transform: ts.TransformerFactory<ts.SourceFile> = (context) => {
    const factory = context.factory;
    function defer(block: ts.Statement): ts.Statement {
      deferred++;
      block = ts.visitNode(block, safetyVisitor) as ts.Statement;
      return factory.createExpressionStatement(
        factory.createCallExpression(
          factory.createPropertyAccessExpression(
            factory.createPropertyAccessExpression(
              factory.createIdentifier("globalThis"),
              "__djlMultiPost",
            ),
            "defer",
          ),
          undefined,
          [
            factory.createArrowFunction(
              [factory.createModifier(ts.SyntaxKind.AsyncKeyword)],
              undefined,
              [],
              undefined,
              factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
              ts.isBlock(block) ? block : factory.createBlock([block], true),
            ),
          ],
        ),
      );
    }
    const safetyVisitor: ts.Visitor = (item) => {
      if (
        ts.isCallExpression(item) &&
        ((ts.isIdentifier(item.expression) && item.expression.text === "fetch") ||
          (ts.isPropertyAccessExpression(item.expression) &&
            ["click", "dispatchEvent", "send", "submit", "requestSubmit"].includes(
              item.expression.name.text,
            )))
      ) {
        const gate = factory.createPropertyAccessExpression(
          factory.createIdentifier("globalThis"),
          "__djlMultiPost",
        );
        if (ts.isIdentifier(item.expression))
          return factory.createCallExpression(
            factory.createPropertyAccessExpression(gate, "fetch"),
            undefined,
            item.arguments,
          );
        return factory.createCallExpression(
          factory.createPropertyAccessExpression(gate, "perform"),
          undefined,
          [
            factory.createArrowFunction(
              undefined,
              undefined,
              [],
              undefined,
              factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
              item,
            ),
          ],
        );
      }
      return ts.visitEachChild(item, safetyVisitor, context);
    };
    const visitor: ts.Visitor = (node) => {
      if (ts.isImportDeclaration(node)) return undefined;
      if (
        ts.isFunctionDeclaration(node) &&
        node.modifiers?.some((x) => x.kind === ts.SyntaxKind.ExportKeyword)
      ) {
        exported = node.name!.text;
        return factory.updateFunctionDeclaration(
          node,
          node.modifiers.filter((x) => x.kind !== ts.SyntaxKind.ExportKeyword),
          node.asteriskToken,
          node.name,
          node.typeParameters,
          node.parameters,
          node.type,
          ts.visitNode(node.body!, visitor) as ts.Block,
        );
      }
      if (ts.isBlock(node)) {
        const statements: ts.Statement[] = [];
        for (let i = 0; i < node.statements.length; i++) {
          const statement = node.statements[i]!;
          if (
            ts.isIfStatement(statement) &&
            /isAutoPublish/.test(statement.expression.getText(source)) &&
            /^(!|.*!==|.*===\s*false)/.test(statement.expression.getText(source)) &&
            (ts.isReturnStatement(statement.thenStatement) ||
              (ts.isBlock(statement.thenStatement) &&
                ts.isReturnStatement(statement.thenStatement.statements.at(-1)!)))
          ) {
            statements.push(defer(factory.createBlock(node.statements.slice(i), true)));
            // A boolean helper reports successful preparation to its caller while
            // the final side effects remain deferred behind the host gate.
            let enclosing: ts.Node | undefined = node.parent;
            while (enclosing && !ts.isFunctionLike(enclosing)) enclosing = enclosing.parent;
            if (
              enclosing &&
              ts.isFunctionLike(enclosing) &&
              enclosing.type?.getText(source).includes("boolean")
            )
              statements.push(factory.createReturnStatement(factory.createTrue()));
            return factory.updateBlock(node, statements);
          }
          statements.push(ts.visitNode(statement, visitor) as ts.Statement);
        }
        return factory.updateBlock(node, statements);
      }
      if (
        ts.isIfStatement(node) &&
        /isAutoPublish/.test(node.expression.getText(source)) &&
        !node.expression.getText(source).startsWith("!")
      ) {
        // An explicit unsupported-mode guard is not an automatic publisher.
        const branch = ts.isBlock(node.thenStatement)
          ? node.thenStatement.statements
          : [node.thenStatement];
        const earlyExit = branch.every(
          (statement) =>
            ts.isReturnStatement(statement) ||
            ts.isThrowStatement(statement) ||
            (ts.isExpressionStatement(statement) &&
              /^console\.(?:warn|error|log|debug)\(/.test(statement.getText(source))),
        );
        if (earlyExit) return ts.visitEachChild(node, safetyVisitor, context);
        // Weibo's outer branch invokes its preparation helper. That helper's
        // negative-auto guard owns the actual final submit tail.
        if (node.thenStatement.getText(source).includes("publishWithDomFallback(articleData)"))
          return ts.visitEachChild(node, visitor, context);
        return factory.updateIfStatement(
          node,
          node.expression,
          defer(node.thenStatement),
          node.elseStatement,
        );
      }
      if (ts.isExpressionStatement(node) && /\.publishIfAutoEnabled\(/.test(node.getText(source)))
        return defer(node);
      if (
        ts.isCallExpression(node) &&
        ((ts.isIdentifier(node.expression) && node.expression.text === "fetch") ||
          (ts.isPropertyAccessExpression(node.expression) &&
            ["click", "dispatchEvent", "send", "submit", "requestSubmit"].includes(
              node.expression.name.text,
            )))
      ) {
        const gate = factory.createPropertyAccessExpression(
          factory.createIdentifier("globalThis"),
          "__djlMultiPost",
        );
        if (ts.isIdentifier(node.expression))
          return factory.createCallExpression(
            factory.createPropertyAccessExpression(gate, "fetch"),
            undefined,
            node.arguments,
          );
        return factory.createCallExpression(
          factory.createPropertyAccessExpression(gate, "perform"),
          undefined,
          [
            factory.createArrowFunction(
              undefined,
              undefined,
              [],
              undefined,
              factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
              node,
            ),
          ],
        );
      }
      if (
        ts.isExpressionStatement(node) &&
        ts.isCallExpression(node.expression) &&
        ts.isIdentifier(node.expression.expression) &&
        asyncNames.has(node.expression.expression.text)
      ) {
        let parent: ts.Node | undefined = node.parent;
        while (parent && !ts.isFunctionLike(parent)) parent = parent.parent;
        if (
          parent &&
          ts.canHaveModifiers(parent) &&
          ts.getModifiers(parent)?.some((mod) => mod.kind === ts.SyntaxKind.AsyncKeyword)
        )
          return factory.updateExpressionStatement(
            node,
            factory.createAwaitExpression(
              ts.visitNode(node.expression, safetyVisitor) as ts.Expression,
            ),
          );
      }
      return ts.visitEachChild(node, visitor, context);
    };
    return (input) => ts.visitNode(input, visitor) as ts.SourceFile;
  };
  const result = ts.transform(source, [transform]);
  const modified = printer.printFile(result.transformed[0]!);
  result.dispose();
  const code = ts.transpileModule(modified.replace(/^export\s+/gm, ""), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.None,
      removeComments: true,
    },
  }).outputText;
  return { source: `${code}\nreturn ${exported};`, deferred };
}
function property(obj: ts.ObjectLiteralExpression, name: string) {
  return obj.properties.find(
    (p) => ts.isPropertyAssignment(p) && p.name.getText().replace(/["']/g, "") === name,
  ) as ts.PropertyAssignment | undefined;
}
function text(obj: ts.ObjectLiteralExpression, name: string) {
  const value = property(obj, name)?.initializer;
  return value && ts.isStringLiteral(value) ? value.text : "";
}
const messages = JSON.parse(readFileSync(resolve(root, "vendor/messages-en.json"), "utf8"));
const adapters = [];
for (const kind of ["dynamic", "article", "video", "podcast"]) {
  const file = resolve(root, `vendor/sync/${kind}.ts`);
  const ast = parse(file);
  const imports = new Map<string, string>();
  for (const statement of ast.statements)
    if (
      ts.isImportDeclaration(statement) &&
      statement.importClause?.namedBindings &&
      ts.isNamedImports(statement.importClause.namedBindings)
    )
      for (const item of statement.importClause.namedBindings.elements)
        imports.set(
          item.name.text,
          resolve(dirname(file), (statement.moduleSpecifier as ts.StringLiteral).text + ".ts"),
        );
  const inspect = (node: ts.Node) => {
    if (
      ts.isPropertyAssignment(node) &&
      ts.isObjectLiteralExpression(node.initializer) &&
      /^(DYNAMIC|ARTICLE|VIDEO|PODCAST)_/.test(node.name.getText())
    ) {
      const obj = node.initializer;
      const fn = property(obj, "injectFunction")?.initializer.getText(ast);
      const sourcePath = fn ? imports.get(fn) : undefined;
      if (!sourcePath) throw new Error(`Missing adapter ${node.name.getText()}`);
      const compiled = browserSource(sourcePath);
      const id = node.name.getText().replace(/["']/g, "");
      if (id === "ARTICLE_CSDN") {
        // Upstream always sends status=2 regardless of isAutoPublish. Defer the
        // complete API publisher, retaining its uploads/signing/configuration.
        compiled.source = `const original=(()=>{${compiled.source}})();return async data=>{const preview=document.createElement('article');preview.textContent=[data.data.title,data.data.markdownContent||data.data.htmlContent].filter(Boolean).join('\\n');document.body.append(preview);globalThis.__djlMultiPost.defer(()=>original(data));};`;
        compiled.deferred = 1;
      }
      if (id === "DYNAMIC_WEBHOOK") {
        compiled.source = `const original=(()=>{${compiled.source}})();return async data=>{globalThis.__djlMultiPost.defer(()=>original(data));};`;
        compiled.deferred = 1;
      }
      const registeredHost = new URL(text(obj, "injectUrl")).hostname;
      compiled.source = compiled.source.replace(
        /window\.location\.href\.includes\("([a-z0-9.-]+)"\)/g,
        (original, expected: string) =>
          expected.includes(".")
            ? `(new URL(window.location.href).hostname===${JSON.stringify(registeredHost)}||${original})`
            : original,
      );
      adapters.push({
        id,
        kind,
        platformKey: text(obj, "accountKey"),
        displayName:
          messages[
            /getMessage\("([^"]+)"\)/.exec(
              property(obj, "platformName")?.initializer.getText(ast) ?? "",
            )?.[1] ?? ""
          ]?.message ?? text(obj, "accountKey"),
        homeUrl: text(obj, "homeUrl").replace(/^http:/, "https:"),
        injectUrl: text(obj, "injectUrl").replace(/^http:/, "https:"),
        sourcePath: sourcePath.slice(root.length + 1),
        automaticSubmit: compiled.deferred > 0,
        supportsNativeScheduling: compiled.source.includes("scheduledPublishTime"),
        ...compiled,
      });
    }
    ts.forEachChild(node, inspect);
  };
  inspect(ast);
}
const accounts: Record<string, string> = {};
const accountAst = parse(resolve(root, "vendor/sync/account.ts"));
const imports = new Map<string, string>();
for (const s of accountAst.statements)
  if (
    ts.isImportDeclaration(s) &&
    s.importClause?.namedBindings &&
    ts.isNamedImports(s.importClause.namedBindings)
  )
    for (const b of s.importClause.namedBindings.elements)
      imports.set(b.name.text, (s.moduleSpecifier as ts.StringLiteral).text);
function accountNodes(node: ts.Node) {
  if (ts.isPropertyAssignment(node) && ts.isObjectLiteralExpression(node.initializer)) {
    const fn = property(node.initializer, "getAccountInfo")?.initializer.getText(accountAst);
    const relative = fn ? imports.get(fn) : undefined;
    if (relative)
      accounts[node.name.getText().replace(/["']/g, "")] = browserSource(
        resolve(root, "vendor/sync", relative + ".ts"),
      ).source;
  }
  ts.forEachChild(node, accountNodes);
}
accountNodes(accountAst);
if (adapters.length !== 110 || Object.keys(accounts).length !== 16)
  throw new Error("Incomplete upstream import");
const helperBuild = await Bun.build({
  entrypoints: [resolve(root, "vendor/contents/helper.ts")],
  format: "iife",
  target: "browser",
  write: false,
  plugins: [
    {
      name: "multipost-helper-alias",
      setup(build) {
        build.onResolve({ filter: /^~contents\/helper$/ }, () => ({
          path: resolve(root, "vendor/contents/helper.ts"),
        }));
      },
    },
  ],
});
if (!helperBuild.success) throw new Error(String(helperBuild.logs));
const helperSource = await helperBuild.outputs[0]!.text();
writeFileSync(
  resolve(root, "src/generated.json"),
  JSON.stringify({
    helperSource,
    commit: "5522ca01100a58572de3a652aebd7851f5fa648a",
    adapters,
    accounts,
  }) + "\n",
);
console.log(
  `Generated ${adapters.length} adapters, ${Object.keys(accounts).length} identity resolvers; ${adapters.filter((x) => x.automaticSubmit).length} deferred submit paths`,
);
