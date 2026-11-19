import { it, expect } from "vitest";
import { scopedDjlToolName } from "./scopedDjlToolName";
it("routes MultiPost to its own scoped MCP without changing computer or native tools", () => {
  expect(scopedDjlToolName("djl_multipost_submit", "work_chat", "djl_multipost_chat")).toBe(
    "djl_multipost_chat_djl_multipost_submit",
  );
  expect(scopedDjlToolName("computer_observe", "work_chat", "djl_multipost_chat")).toBe(
    "work_chat_computer_observe",
  );
  expect(scopedDjlToolName("read", "work_chat", "djl_multipost_chat")).toBe("read");
  expect(scopedDjlToolName("djl_multipost_submit", "work_chat", undefined)).toBe(
    "djl_multipost_submit",
  );
});
