// FILE: project-handler.test.js
// Purpose: Verifies safe local project folder browsing and creation RPC helpers.
// Layer: Unit test
// Exports: node:test suite
// Depends on: node:test, node:assert/strict, fs, os, path, ../src/project-handler

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  handleProjectRequest,
  handleProjectMethod,
  projectCreateDirectory,
  projectCreateRootlessChatRoot,
  projectListDirectory,
  projectProjectlessRoots,
  projectSearchDirectories,
  projectValidatePath,
  rootlessChatSlugFromPromptHint,
} = require("../src/project-handler");

function makeTempHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "djl-project-handler-"));
}

test("project/quickLocations only returns existing allowed folders", async () => {
  const homeDir = makeTempHome();
  fs.mkdirSync(path.join(homeDir, "Developer"));

  const result = await handleProjectMethod("project/quickLocations", {}, { homeDir });

  assert.deepEqual(
    result.locations.map((location) => location.id),
    ["home", "developer"],
  );
});

test("project/projectlessRoots returns host-side Codex chat roots", async () => {
  const homeDir = makeTempHome();
  const codexHome = path.join(homeDir, ".custom-codex");
  const result = await projectProjectlessRoots({ homeDir, codexHome });

  assert.equal(result.codexHome, codexHome);
  assert.equal(result.documentedThreadsRoot, path.join(codexHome, "threads"));
  assert.equal(result.desktopDocumentsRoot, path.join(homeDir, "Documents", "Codex"));
  assert.deepEqual(result.roots, [
    path.join(codexHome, "threads"),
    path.join(homeDir, "Documents", "Codex"),
  ]);
});

test("project/listDirectory returns sorted child folders and skips files or hidden folders by default", async () => {
  const homeDir = makeTempHome();
  fs.mkdirSync(path.join(homeDir, "Zoo"));
  fs.mkdirSync(path.join(homeDir, "app"));
  fs.mkdirSync(path.join(homeDir, ".hidden"));
  fs.mkdirSync(path.join(homeDir, "Library"));
  fs.writeFileSync(path.join(homeDir, "notes.txt"), "hello");

  const result = await projectListDirectory({ path: homeDir }, { homeDir });

  assert.equal(result.path, fs.realpathSync(homeDir));
  assert.equal(result.parentPath, null);
  assert.deepEqual(
    result.entries.map((entry) => entry.name),
    ["app", "Zoo"],
  );
});

test("project/createDirectory creates one child folder under an allowed parent", async () => {
  const homeDir = makeTempHome();

  const result = await projectCreateDirectory(
    {
      parentPath: homeDir,
      name: "New App",
    },
    { homeDir },
  );

  assert.equal(result.path, path.join(fs.realpathSync(homeDir), "New App"));
  assert.equal(fs.statSync(result.path).isDirectory(), true);
});

test("project/searchDirectories finds matching child folders recursively", async () => {
  const homeDir = makeTempHome();
  fs.mkdirSync(path.join(homeDir, "Developer"));
  fs.mkdirSync(path.join(homeDir, "Developer", "ClientApp"));
  fs.mkdirSync(path.join(homeDir, "Developer", "ClientApp", "ios"));
  fs.mkdirSync(path.join(homeDir, "Developer", "Other"));
  fs.writeFileSync(path.join(homeDir, "Developer", "client-notes.txt"), "hello");

  const result = await projectSearchDirectories(
    {
      path: path.join(homeDir, "Developer"),
      query: "client",
    },
    { homeDir },
  );

  assert.equal(result.path, fs.realpathSync(path.join(homeDir, "Developer")));
  assert.deepEqual(
    result.entries.map((entry) => entry.name),
    ["ClientApp"],
  );
});

test("project/searchDirectories respects depth and hidden folder bounds", async () => {
  const homeDir = makeTempHome();
  fs.mkdirSync(path.join(homeDir, "Visible"));
  fs.mkdirSync(path.join(homeDir, "Visible", "DeepMatch"));
  fs.mkdirSync(path.join(homeDir, ".match-hidden"));

  const result = await projectSearchDirectories(
    {
      path: homeDir,
      query: "match",
      maxDepth: 0,
    },
    { homeDir },
  );

  assert.deepEqual(
    result.entries.map((entry) => entry.name),
    [],
  );
});

test("project/createDirectory rejects names that escape the selected parent", async () => {
  const homeDir = makeTempHome();

  await assert.rejects(
    () =>
      projectCreateDirectory(
        {
          parentPath: homeDir,
          name: "../escape",
        },
        { homeDir },
      ),
    /Folder names cannot contain path separators/,
  );
});

test("project/listDirectory rejects relative paths so bridge cwd never decides browsing scope", async () => {
  const homeDir = makeTempHome();

  await assert.rejects(
    () => projectListDirectory({ path: "." }, { homeDir }),
    /Use an absolute folder path/,
  );
});

test("project/listDirectory keeps symlink display names while returning the resolved folder path", async () => {
  const homeDir = makeTempHome();
  const targetDir = path.join(homeDir, "ActualRepo");
  const linkPath = path.join(homeDir, "ClientApp");
  fs.mkdirSync(targetDir);
  fs.symlinkSync(targetDir, linkPath, "dir");

  const result = await projectListDirectory({ path: homeDir }, { homeDir });
  const linkEntry = result.entries.find((entry) => entry.name === "ClientApp");

  assert.equal(linkEntry?.path, fs.realpathSync(targetDir));
  assert.equal(linkEntry?.isSymlink, true);
});

test("project/validatePath rejects folders outside the allowed home root", async () => {
  const homeDir = makeTempHome();
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "djl-outside-"));

  const result = await projectValidatePath({ path: outsideDir }, { homeDir });

  assert.equal(result.isAllowed, false);
  assert.equal(result.exists, false);
  assert.equal(result.isDirectory, false);
});

test("rootlessChatSlugFromPromptHint mirrors Codex Desktop's kebab-case slug shape", () => {
  assert.equal(
    rootlessChatSlugFromPromptHint("mi dici la pwd corrente?"),
    "mi-dici-la-pwd-corrente",
  );
  assert.equal(
    rootlessChatSlugFromPromptHint("  Mi FAI un cwd di dove siamo davvero, grazie!"),
    "mi-fai-un-cwd-di-dove",
  );
  assert.equal(rootlessChatSlugFromPromptHint(""), "new-chat");
  assert.equal(rootlessChatSlugFromPromptHint("   ¿¿¿ !!! "), "new-chat");
  assert.equal(rootlessChatSlugFromPromptHint(null), "new-chat");
});

test("project/createRootlessChatRoot materializes a dated Documents/Codex slug folder", async () => {
  const homeDir = makeTempHome();
  const result = await projectCreateRootlessChatRoot(
    { promptHint: "Mi dici la pwd corrente?", dateFolder: "2026-05-19" },
    { homeDir },
  );

  const expectedRoot = path.join(homeDir, "Documents", "Codex");
  const expectedParent = path.join(expectedRoot, "2026-05-19");
  const expectedPath = path.join(expectedParent, "mi-dici-la-pwd-corrente");

  assert.equal(result.root, expectedRoot);
  assert.equal(result.parentPath, expectedParent);
  assert.equal(result.path, fs.realpathSync(expectedPath));
  assert.equal(result.slug, "mi-dici-la-pwd-corrente");
  assert.equal(result.dateFolder, "2026-05-19");
  assert.equal(fs.statSync(expectedPath).isDirectory(), true);
  assert.equal(fs.existsSync(path.join(expectedPath, ".git")), false);
});

test("project/createRootlessChatRoot dedupes colliding slugs in the same day", async () => {
  const homeDir = makeTempHome();
  const firstResult = await projectCreateRootlessChatRoot(
    { promptHint: "Same idea twice", dateFolder: "2026-05-19" },
    { homeDir },
  );
  const secondResult = await projectCreateRootlessChatRoot(
    { promptHint: "Same idea twice", dateFolder: "2026-05-19" },
    { homeDir },
  );

  assert.equal(path.basename(firstResult.path), "same-idea-twice");
  assert.equal(path.basename(secondResult.path), "same-idea-twice-2");
});

test("project/createRootlessChatRoot rejects malformed date folders", async () => {
  const homeDir = makeTempHome();

  await assert.rejects(
    () =>
      projectCreateRootlessChatRoot({ promptHint: "hello", dateFolder: "2026/05/19" }, { homeDir }),
    /chat date folder must be in YYYY-MM-DD format/,
  );
});

test("handleProjectRequest responds to project JSON-RPC requests", async () => {
  const homeDir = makeTempHome();
  const previousHome = process.env.HOME;
  process.env.HOME = homeDir;
  let response = "";
  let resolveResponse;
  const responsePromise = new Promise((resolve) => {
    resolveResponse = resolve;
  });

  try {
    const handled = handleProjectRequest(
      JSON.stringify({
        id: "project-1",
        method: "project/listDirectory",
        params: { path: homeDir },
      }),
      (payload) => {
        response = payload;
        resolveResponse();
      },
    );

    assert.equal(handled, true);
    await responsePromise;
  } finally {
    if (previousHome == null) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }
  }

  assert.equal(JSON.parse(response).id, "project-1");
  assert.equal(JSON.parse(response).result.path, fs.realpathSync(homeDir));
});
