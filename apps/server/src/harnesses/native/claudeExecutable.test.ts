import { chmod, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { claudeExecutableCandidates, resolveClaudeExecutable } from "./claudeExecutable";

const roots: string[] = [];
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "djl-claude-path-")));
  roots.push(root);
  return root;
}
async function executable(path: string) {
  await writeFile(path, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  return path;
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Claude executable resolution", () => {
  it("resolves a PATH command and follows native installer symlinks", async () => {
    const root = await fixture();
    const binary = await executable(join(root, "native-version"));
    await symlink(binary, join(root, "claude"));
    expect(await resolveClaudeExecutable("claude", { PATH: root })).toBe(binary);
  });
  it("keeps an explicit executable with spaces and never falls back from an invalid override", async () => {
    const root = await fixture();
    const binary = await executable(join(root, "my claude"));
    await executable(join(root, "claude"));
    expect(await resolveClaudeExecutable(binary, { PATH: root })).toBe(binary);
    await expect(resolveClaudeExecutable(join(root, "missing"), { PATH: root })).rejects.toThrow(
      "Settings > Accounts",
    );
  });
  it("finds the native install with a minimal desktop PATH", async () => {
    const root = await fixture();
    const bin = join(root, ".local", "bin");
    await mkdir(bin, { recursive: true });
    const binary = await executable(join(bin, "claude"));
    expect(await resolveClaudeExecutable("claude", { PATH: "", HOME: root })).toBe(binary);
  });
  it("rejects non-executable files and directories", async () => {
    const root = await fixture();
    const binary = await executable(join(root, "claude"));
    await chmod(binary, 0o644);
    await expect(resolveClaudeExecutable(binary, {})).rejects.toThrow("executable not found");
    await expect(resolveClaudeExecutable(root, {})).rejects.toThrow("executable not found");
  });
  it("uses Windows PATH casing and native exe candidates without invoking a shell", () => {
    expect(
      claudeExecutableCandidates(
        "claude",
        {
          Path: "C:\\Tools;D:\\My CLI",
          USERPROFILE: "C:\\Users\\me",
        },
        "win32",
      ),
    ).toEqual([
      "C:\\Tools\\claude.exe",
      "D:\\My CLI\\claude.exe",
      "C:\\Users\\me\\.local\\bin\\claude.exe",
    ]);
    expect(claudeExecutableCandidates("C:\\My CLI\\claude.exe", {}, "win32")).toEqual([
      "C:\\My CLI\\claude.exe",
    ]);
  });
});
