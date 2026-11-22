import { describe, expect, it } from "vitest";

import {
  findBrandIdentityViolations,
  findPinnedThirdPartyAssetViolations,
  findVisualBrandAssetViolations,
  isBrandIdentityTextSearchable,
  readTrackedFiles,
} from "./check-brand-identity";

const characters = (...codes: number[]): string => String.fromCharCode(...codes);
const shortName = characters(116, 51);
const firstName = `${shortName}${characters(99, 111, 100, 101)}`;
const secondName = characters(100, 112, 99, 111, 100, 101);
const retiredProductName = characters(83, 121, 110, 97, 114, 97);

describe("brand identity guard", () => {
  it("detects retired names in paths and text", () => {
    const violations = findBrandIdentityViolations([
      { path: `docs/${firstName}.md`, contents: "DJL" },
      { path: "source.ts", contents: `const value = "${secondName}:state";` },
    ]);
    expect(violations).toHaveLength(2);
  });

  it("does not match ordinary numeric type names", () => {
    expect(
      findBrandIdentityViolations([
        { path: "source.ts", contents: "const value = new Uint32Array();" },
      ]),
    ).toEqual([]);
  });

  it("flags the retired product name anywhere, even in comments", () => {
    expect(
      findBrandIdentityViolations([
        {
          path: "source.ts",
          contents: `const value = new Uint32Array(); // ${retiredProductName}`,
        },
      ]),
    ).toHaveLength(1);
  });

  it("flags the upstream author's handle and account but not their copyright notice", () => {
    const handle = characters(
      101,
      109,
      97,
      110,
      117,
      101,
      108,
      101,
      100,
      105,
      112,
      105,
      101,
      116,
      114,
      111,
    );
    const account = characters(69, 109, 97, 110, 117, 101, 108, 101, 45, 119, 101, 98, 48, 52);
    const notice = `Copyright (c) 2026 ${characters(69, 109, 97, 110, 117, 101, 108, 101)} Di Pietro`;
    expect(
      findBrandIdentityViolations([
        { path: "a.ts", contents: `const id = "com.${handle}.app";` },
        { path: "b.md", contents: `https://github.com/${account}/repo` },
        { path: "LICENSE", contents: notice },
      ]).map(({ path }) => path),
    ).toEqual(["a.ts", "b.md"]);
  });

  it("rejects the retired product name in instructions and code", () => {
    const violations = findBrandIdentityViolations([
      { path: "AGENTS.md", contents: `${retiredProductName} is a coding-agent GUI.` },
      { path: "CLAUDE.md", contents: `${retiredProductName} supports multiple providers.` },
      {
        path: "source.ts",
        contents: `const compatibilityPath = "~/.${retiredProductName.toLowerCase()}";`,
      },
    ]);

    expect(violations.map(({ path }) => path)).toEqual(["AGENTS.md", "CLAUDE.md", "source.ts"]);
  });

  it("rejects retired identity in legal notices", () => {
    const notice = `Copyright (c) 2026 ${characters(84, 51)} ${characters(
      84,
      111,
      111,
      108,
      115,
    )} Inc.`;
    expect(findBrandIdentityViolations([{ path: "LICENSE", contents: notice }])).toHaveLength(1);
    expect(
      findBrandIdentityViolations([{ path: "docs/license-copy.md", contents: notice }]),
    ).toHaveLength(1);
  });

  it("allows retired runtime paths only in the tracked ignore policy", () => {
    expect(
      findBrandIdentityViolations([
        {
          path: ".gitignore",
          contents: [`.${firstName}/`, `.${secondName}/`].join("\n"),
        },
      ]),
    ).toEqual([]);
  });

  it("requires user-facing raster assets to match a visually approved digest", () => {
    const approvedContents = new TextEncoder().encode("approved screenshot");
    const approvedDigest = "5dcf96efdc1aeee57a624c094c538da8570b938f62df517f4e5081359dcfc17f";
    const approvedDigests = new Map([["screenshot.jpeg", approvedDigest]]);

    expect(
      findVisualBrandAssetViolations(
        [{ path: "screenshot.jpeg", contents: approvedContents }],
        approvedDigests,
      ),
    ).toEqual([]);
    expect(
      findVisualBrandAssetViolations(
        [{ path: "screenshot.jpeg", contents: new TextEncoder().encode("changed") }],
        approvedDigests,
      ),
    ).toHaveLength(1);
    expect(findVisualBrandAssetViolations([], approvedDigests)).toHaveLength(1);
  });

  it("reads tracked symlink blobs without dereferencing their working-tree targets", () => {
    const files = readTrackedFiles({
      listPaths: () => ["linked-directory"],
      readBlob: (path) => {
        expect(path).toBe("linked-directory");
        return Buffer.from("../actual-directory");
      },
    });

    expect(files).toEqual([
      {
        path: "linked-directory",
        contents: Buffer.from("../actual-directory"),
      },
    ]);
  });

  it("does not scan third-party vendor blobs as first-party DJL identity", () => {
    const files = readTrackedFiles({
      listPaths: () => ["apps/web/src/app.ts", "vendor/opencode/test-fixture.json"],
      readBlob: (path) => Buffer.from(path),
    });

    expect(files.map(({ path }) => path)).toEqual(["apps/web/src/app.ts"]);
  });

  it("digest-pins third-party minified sources instead of scanning tokens as DJL branding", () => {
    const path = "third-party/mermaid.min.js";
    const contents = Buffer.from(`const ${characters(84, 51)} = 1`);
    const digests = new Map([
      [path, "d09b2addc4c54731e2a9a0aff7e838eb044a0452aabb34150f0b0f23cc0f9ea9"],
    ]);

    expect(isBrandIdentityTextSearchable(path, digests)).toBe(false);
    expect(findPinnedThirdPartyAssetViolations([{ path, contents }], digests)).toEqual([]);
    expect(
      findPinnedThirdPartyAssetViolations(
        [{ path, contents: Buffer.from(`const ${characters(84, 51)} = 2`) }],
        digests,
      ),
    ).toHaveLength(1);
  });
});
