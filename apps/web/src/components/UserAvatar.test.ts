import { describe, expect, it } from "vitest";

import { avatarInitials } from "./UserAvatar";

describe("avatarInitials", () => {
  it("takes one letter from each of the first two name parts, else the first two letters", () => {
    expect(avatarInitials("ada.lovelace@example.com")).toBe("AL");
    expect(avatarInitials("grace_hopper+djl@example.com")).toBe("GH");
    expect(avatarInitials("me@test.invalid")).toBe("ME");
    expect(avatarInitials("x@example.com")).toBe("X");
  });
});
