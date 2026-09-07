import { ThreadId } from "@synara/contracts";
import { describe, expect, it } from "vitest";
import { codexPermissions } from "./codex";

describe("Codex native permission profiles", () => {
  it.each([
    ["approval-required", "untrusted", "workspace-write", "user"],
    ["auto-approval", "on-request", "workspace-write", "auto_review"],
    ["full-access", "never", "danger-full-access", "user"],
  ] as const)(
    "maps %s to the native policy, sandbox and reviewer",
    (runtimeMode, approvalPolicy, sandbox, approvalsReviewer) => {
      expect(
        codexPermissions({ threadId: ThreadId.makeUnsafe("permissions"), runtimeMode }),
      ).toEqual({ approvalPolicy, sandbox, approvalsReviewer });
    },
  );
  it("rejects combinations that would disable automatic review", () => {
    const input = {
      threadId: ThreadId.makeUnsafe("permissions"),
      runtimeMode: "auto-approval" as const,
    };
    expect(() => codexPermissions({ ...input, approvalPolicy: "never" })).toThrow(
      "requires on-request",
    );
    expect(() => codexPermissions({ ...input, sandboxMode: "danger-full-access" })).toThrow(
      "requires on-request",
    );
    expect(codexPermissions({ ...input, sandboxMode: "read-only" })).toMatchObject({
      sandbox: "read-only",
      approvalsReviewer: "auto_review",
    });
  });
});
