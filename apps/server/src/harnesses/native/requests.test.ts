import { describe, expect, it } from "vitest";
import { nativeApprovalDetail, nativeQuestions } from "./requests";

describe("native request translation", () => {
  it("retains Claude native question-text answer keys and Codex explicit ids", () => {
    expect(
      nativeQuestions({
        questions: [{ question: "Pick a file", header: "File", options: [], multiSelect: true }],
      })[0],
    ).toMatchObject({ id: "Pick a file", multiSelect: true });
    expect(
      nativeQuestions({
        questions: [
          {
            id: "chosen_file",
            question: "Pick a file",
            header: "File",
            options: [{ label: "A", description: "File A" }],
          },
        ],
      })[0]?.id,
    ).toBe("chosen_file");
  });
  it("keeps actual Codex command/file, Claude input and Cursor operation context in detail", () => {
    expect(nativeApprovalDetail({ command: "git status", cwd: "/project" })).toContain(
      "git status",
    );
    expect(
      nativeApprovalDetail({ item: { changes: [{ path: "/project/a.ts", diff: "+change" }] } }),
    ).toContain("/project/a.ts");
    expect(
      nativeApprovalDetail({ tool: "Read", input: { file_path: "/project/secret.txt" } }),
    ).toContain("/project/secret.txt");
    expect(
      nativeApprovalDetail({
        toolCall: { title: "Edit config", locations: [{ path: "/project/config.json" }] },
      }),
    ).toContain("/project/config.json");
  });
});
