import { describe, expect, it } from "vitest";

import { projectPickerCopy } from "./ProjectPicker";

describe("projectPickerCopy", () => {
  it("describes all Work locations in nontechnical language", () => {
    const copy = {
      "projectPicker.work.trigger": "Managed Work folder",
      "projectPicker.work.search": "Search work locations",
      "projectPicker.work.activeGroup": "Projects and recent folders",
      "projectPicker.work.chooseFolder": "Choose another folder",
      "projectPicker.work.managed": "Managed Work folder",
      "projectPicker.work.managedDetail": "Private folder for this task",
    } as const;
    expect(projectPickerCopy("work", (key) => copy[key as keyof typeof copy])).toEqual(
      expect.objectContaining({
        trigger: "Managed Work folder",
        activeGroup: "Projects and recent folders",
        chooseFolder: "Choose another folder",
        managedDetail: "Private folder for this task",
      }),
    );
  });
});
