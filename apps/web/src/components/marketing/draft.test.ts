import { describe, it, expect } from "vitest";
import { initialDraft, editDraft, receiveDraft } from "./draft";
describe("editor conflict protection", () => {
  it("keeps the original save version and local edits when a newer remote version arrives", () => {
    const local = editDraft(initialDraft({ value: "original", version: 2 }), "my unsaved edit");
    const after = receiveDraft(local, { value: "someone else saved", version: 3 });
    expect(after.value).toBe("my unsaved edit");
    expect(after.base.version).toBe(2);
  });
  it("adopts newer saved content only when the editor has no local changes", () => {
    expect(
      receiveDraft(initialDraft({ value: "old", version: 2 }), { value: "new", version: 3 }),
    ).toEqual(initialDraft({ value: "new", version: 3 }));
  });
  it("does not roll back an accepted save while the query cache still contains an older response", () => {
    const accepted = initialDraft({ value: "saved changes", version: 3 });
    expect(receiveDraft(accepted, { value: "previous content", version: 2 })).toBe(accepted);
  });
});
