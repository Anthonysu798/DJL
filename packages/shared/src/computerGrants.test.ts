import { expect, it } from "vitest";
import { computerPermissionSetupMessage } from "./computerGrants";
it("names DJL in the permission instructions", () => {
  const message = computerPermissionSetupMessage(
    ["accessibility", "inputMonitoring", "screenRecording"],
    "signed",
    "com.djl.qa.computer-use",
  );
  expect(message).toContain("DJL needs");
});
