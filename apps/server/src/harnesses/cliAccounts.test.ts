import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readlink, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DEFAULT_SERVER_SETTINGS, type ServerSettings } from "@djl/contracts";
import { deepMerge } from "@djl/shared/Struct";
import { afterEach, describe, expect, it } from "vitest";
import { claudeKeychainServiceForConfigDir } from "../providerUsage/providers/claude";
import { buildHarnessInvocation } from "./accounts";
import { activeCliAccountDir } from "./cliAccountSelection";
import {
  addCliAccount,
  listCliAccounts,
  removeCliAccount,
  setActiveCliAccount,
} from "./cliAccounts";
import { nativeProfileOptions } from "./native/profile";

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});
async function sandbox() {
  const base = await mkdtemp(path.join(tmpdir(), "djl-cli-accounts-"));
  dirs.push(base);
  const homeDir = path.join(base, "home");
  const root = path.join(base, "userdata", "terminal-accounts");
  await mkdir(path.join(homeDir, ".claude", "skills"), { recursive: true });
  await writeFile(path.join(homeDir, ".claude", "settings.json"), "{}");
  await writeFile(path.join(homeDir, ".claude", ".credentials.json"), "{}");
  return { homeDir, root };
}
const apply = (settings: ServerSettings, patch: object) =>
  deepMerge(settings, patch as never) as ServerSettings;

describe("AI accounts", () => {
  it("reads each Claude account's sign-in from its own store, never by starting Claude", async () => {
    const { homeDir, root } = await sandbox();
    let settings: ServerSettings = deepMerge(DEFAULT_SERVER_SETTINGS, {
      // Any Claude process would fail here, so a signed-in answer can only come from the store.
      providers: { claudeAgent: { binaryPath: path.join(homeDir, "no-claude-here") } },
    } as never) as ServerSettings;
    const accounts = [];
    for (const name of ["Two", "Three", "Four", "Five", "Six"]) {
      const added = await addCliAccount(
        settings,
        { provider: "claudeAgent", name },
        { root, homeDir },
      );
      settings = apply(settings, added.patch);
      accounts.push(added.account);
    }
    const signedIn = accounts.slice(0, 4);
    for (const [index, account] of signedIn.entries()) {
      await writeFile(
        path.join(account.dir, ".credentials.json"),
        JSON.stringify({
          claudeAiOauth: {
            accessToken: "expired",
            refreshToken: `refresh-${index}`,
            expiresAt: Date.now() - 60_000,
            refreshTokenExpiresAt: Date.now() + 20 * 86_400_000,
          },
        }),
      );
      await writeFile(
        path.join(account.dir, ".claude.json"),
        JSON.stringify({ oauthAccount: { emailAddress: `account${index}@example.com` } }),
      );
    }
    const listed = await listCliAccounts(settings, { root, homeDir });
    const byId = new Map(listed.map((item) => [item.id, item]));
    for (const [index, account] of signedIn.entries()) {
      expect(byId.get(account.id)).toMatchObject({
        status: "signedIn",
        email: `account${index}@example.com`,
      });
    }
    expect(byId.get(accounts[4]!.id)?.status).not.toBe("signedIn");
  });

  it("creates an isolated folder that shares config but never the login", async () => {
    const { homeDir, root } = await sandbox();
    const { account, patch } = await addCliAccount(
      DEFAULT_SERVER_SETTINGS,
      { provider: "claudeAgent", name: "Work" },
      { root, homeDir },
    );
    expect(account.dir).toBe(path.join(root, "claudeAgent", account.id));
    expect(account.id).toMatch(/^claude-[a-f0-9]{10}$/);
    expect((await stat(account.dir)).isDirectory()).toBe(true);
    expect(await readlink(path.join(account.dir, "settings.json"))).toBe(
      path.join(homeDir, ".claude", "settings.json"),
    );
    expect(await readlink(path.join(account.dir, "skills"))).toBe(
      path.join(homeDir, ".claude", "skills"),
    );
    await expect(lstat(path.join(account.dir, ".credentials.json"))).rejects.toThrow();
    expect(apply(DEFAULT_SERVER_SETTINGS, patch).cliAccounts.accounts).toEqual([account]);
  });

  it("runs new chats and sign-in with the active account, and the normal login otherwise", async () => {
    const { homeDir, root } = await sandbox();
    const { account, patch } = await addCliAccount(
      DEFAULT_SERVER_SETTINGS,
      { provider: "codex", name: "Team" },
      { root, homeDir },
    );
    let settings = apply(DEFAULT_SERVER_SETTINGS, patch);
    expect(nativeProfileOptions("codex", settings).codex?.homePath).toBeUndefined();

    settings = apply(settings, setActiveCliAccount(settings, "codex", account.id));
    expect(activeCliAccountDir(settings, "codex")).toBe(account.dir);
    expect(nativeProfileOptions("codex", settings).codex?.homePath).toBe(account.dir);
    expect(buildHarnessInvocation("codex", settings, root, {}).env.CODEX_HOME).toBe(account.dir);
    // A Codex account never changes which Claude login runs.
    expect(nativeProfileOptions("claudeAgent", settings).claudeAgent?.configDir).toBeUndefined();

    settings = apply(settings, setActiveCliAccount(settings, "codex", "default"));
    expect(nativeProfileOptions("codex", settings).codex?.homePath).toBeUndefined();
  });

  it("points Claude at the account's config folder", async () => {
    const { homeDir, root } = await sandbox();
    const { account, patch } = await addCliAccount(
      DEFAULT_SERVER_SETTINGS,
      { provider: "claudeAgent", name: "Personal" },
      { root, homeDir },
    );
    let settings = apply(DEFAULT_SERVER_SETTINGS, patch);
    settings = apply(settings, setActiveCliAccount(settings, "claudeAgent", account.id));
    expect(nativeProfileOptions("claudeAgent", settings).claudeAgent?.configDir).toBe(account.dir);
    expect(buildHarnessInvocation("claudeAgent", settings, root, {}).env.CLAUDE_CONFIG_DIR).toBe(
      account.dir,
    );
  });

  it("refuses to switch to an account that does not exist", () => {
    expect(() => setActiveCliAccount(DEFAULT_SERVER_SETTINGS, "codex", "codex-missing")).toThrow(
      "no longer exists",
    );
  });

  it("removes only DJL's own folder and falls back to the normal login", async () => {
    const { homeDir, root } = await sandbox();
    const { account, patch } = await addCliAccount(
      DEFAULT_SERVER_SETTINGS,
      { provider: "codex", name: "Team" },
      { root, homeDir },
    );
    let settings = apply(DEFAULT_SERVER_SETTINGS, patch);
    settings = apply(settings, setActiveCliAccount(settings, "codex", account.id));
    settings = apply(settings, await removeCliAccount(settings, account.id, { root }));
    expect(settings.cliAccounts.accounts).toEqual([]);
    expect(activeCliAccountDir(settings, "codex")).toBeUndefined();
    await expect(stat(account.dir)).rejects.toThrow();
    // The shared config the folder linked to is untouched.
    expect((await stat(path.join(homeDir, ".claude", "settings.json"))).isFile()).toBe(true);

    // A folder outside DJL's account root is never deleted.
    const outside = path.join(homeDir, "keep-me");
    await mkdir(outside);
    const foreign = apply(DEFAULT_SERVER_SETTINGS, {
      cliAccounts: { accounts: [{ id: "codex-x", provider: "codex", name: "x", dir: outside }] },
    });
    await removeCliAccount(foreign, "codex-x", { root });
    expect((await stat(outside)).isDirectory()).toBe(true);
  });

  it("names Claude's Keychain item the way Claude Code does for a custom config folder", () => {
    const dir = "/Users/me/.djl/userdata/terminal-accounts/claudeAgent/claude-abc";
    const hash = createHash("sha256").update(dir).digest("hex").slice(0, 8);
    expect(claudeKeychainServiceForConfigDir(dir)).toBe(`Claude Code-credentials-${hash}`);
  });
});
