import { describe, expect, it } from "vitest";
import { operationConfirmation, validateServerOperation } from "./operations.ts";
const input = {
  requestId: "bee52ab9-2060-40c9-8c4d-df4884e7acdc",
  action: "restart",
  target: "api",
  confirmation: "RESTART API",
  reason: "Recover service",
};
describe("server operation boundaries", () => {
  it("accepts only a supported service and exact confirmation", () => {
    expect(validateServerOperation(input).target).toBe("api");
    expect(() => validateServerOperation({ ...input, target: "../../etc" })).toThrow();
    expect(() => validateServerOperation({ ...input, confirmation: "yes" })).toThrow();
  });
  it("rejects arbitrary commands, IDs and database deployments", () => {
    expect(() => validateServerOperation({ ...input, action: "exec" })).toThrow();
    expect(() => validateServerOperation({ ...input, requestId: "$(reboot)" })).toThrow();
    expect(() =>
      validateServerOperation({ ...input, action: "deploy", target: "postgres" }),
    ).toThrow();
    expect(() =>
      validateServerOperation({
        ...input,
        action: "deploy",
        confirmation: "DEPLOY API",
        releaseId: "https://image",
      }),
    ).toThrow();
  });
  it("requires VPS confirmation for backup/reboot and a meaningful reason", () => {
    expect(operationConfirmation("reboot", "vps")).toBe("REBOOT VPS");
    expect(
      validateServerOperation({
        ...input,
        action: "backup",
        target: "vps",
        confirmation: "BACK UP DJL",
      }).action,
    ).toBe("backup");
    expect(() => validateServerOperation({ ...input, reason: "" })).toThrow();
  });
});
