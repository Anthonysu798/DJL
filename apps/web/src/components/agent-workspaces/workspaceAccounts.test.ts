import type { CliAccountSummary } from "@djl/contracts";
import { describe, expect, it } from "vitest";

import {
  appAccountProvider,
  resolveWorkspaceProfile,
  terminalProfileId,
} from "~/lib/workspaceAccountIds";
import { mergeWorkspaceAccounts } from "./workspaceAccounts";

const summary = (overrides: Partial<CliAccountSummary>): CliAccountSummary => ({
  id: "default",
  provider: "codex",
  name: "",
  isDefault: true,
  active: true,
  status: "signedIn",
  email: null,
  ...overrides,
});

describe("workspace accounts", () => {
  it("lists the normal sign-ins first, then Settings accounts, then workspace profiles", () => {
    const accounts = mergeWorkspaceAccounts(
      [
        summary({ id: "codex-1", isDefault: false, name: "Work", status: "signedOut" }),
        summary({ provider: "claudeAgent", email: "me@example.com" }),
        summary({ email: "me@openai.com" }),
      ],
      [{ id: "uuid-1", provider: "cursor", name: "Cursor" }],
      "Main account",
    );
    expect(accounts.map((account) => [account.id, account.name, account.fromApp])).toEqual([
      ["default-codex", "Main account", true],
      ["default-claudeAgent", "Main account", true],
      ["codex-1", "Work", true],
      ["uuid-1", "Cursor", false],
    ]);
    expect(accounts[0]!.known).toEqual({ status: "signedIn", email: "me@openai.com" });
    expect(accounts[3]!.known).toBeNull();
  });

  it("still offers the normal sign-ins while Settings loads or fails", () => {
    expect(mergeWorkspaceAccounts(undefined, [], "Main").map((a) => a.known?.status)).toEqual([
      "checking",
      "checking",
    ]);
    expect(mergeWorkspaceAccounts(null, [], "Main").map((a) => a.known?.status)).toEqual([
      "unknown",
      "unknown",
    ]);
  });

  it("maps app account ids to providers and server folders", () => {
    expect(appAccountProvider("default-codex")).toBe("codex");
    expect(appAccountProvider("claude-ab12")).toBe("claudeAgent");
    expect(appAccountProvider("3f2a-uuid")).toBeNull();
    expect(terminalProfileId("default-claudeAgent")).toBe("default");
    expect(terminalProfileId("codex-ab12")).toBe("codex-ab12");
    expect(resolveWorkspaceProfile("codex-ab12", [])).toEqual({
      id: "codex-ab12",
      provider: "codex",
      name: "",
    });
    expect(resolveWorkspaceProfile("gone", [])).toBeUndefined();
    expect(resolveWorkspaceProfile(null, [])).toBeUndefined();
  });
});
