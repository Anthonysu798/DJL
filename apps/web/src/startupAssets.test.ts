import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";

it("does not block the first app paint on a remote stylesheet", () => {
  const html = readFileSync(path.resolve(import.meta.dirname, "../index.html"), "utf8");
  expect(html).not.toMatch(/<link\b[^>]*href=["']https?:[^>]*rel=["']stylesheet/);
  expect(html).not.toMatch(/<link\b[^>]*rel=["']stylesheet[^>]*href=["']https?:/);
  expect(html).not.toContain("fonts.googleapis.com");
});

it("bundles the existing font family names and every referenced font file", () => {
  const css = readFileSync(path.resolve(import.meta.dirname, "bundledFonts.css"), "utf8");
  for (const family of ["DM Sans", "Geist", "Geist Mono", "Inter"]) {
    expect(css).toMatch(new RegExp(`font-family: ["']${family}["']`));
  }
  const urls = [...css.matchAll(/url\(([^)]+)\)/g)].map((match) => match[1]!);
  expect(urls.length).toBeGreaterThan(0);
  for (const url of urls) {
    expect(url).toMatch(/^@fontsource-variable\//);
    expect(existsSync(path.resolve(import.meta.dirname, "../node_modules", url)), url).toBe(true);
  }
  expect(css.match(/^\s*font-display: swap;/gm)).toHaveLength(urls.length);
});

it("keeps terminal rendering out of the sidebar and ordinary chat startup imports", () => {
  for (const [file, moduleName] of [
    ["components/Sidebar.tsx", "./terminal/terminalRuntimeRegistry"],
    ["components/ChatView.tsx", "./ThreadTerminalDrawer"],
  ]) {
    const source = readFileSync(path.resolve(import.meta.dirname, file!), "utf8");
    expect(source.includes(`from "${moduleName}"`), file).toBe(false);
    expect(source).toContain(`import("${moduleName}")`);
  }
});
