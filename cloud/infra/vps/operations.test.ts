import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("enforces controller command, privacy, idempotency and metric boundaries", () => {
  const source = fileURLToPath(new URL("../operations", import.meta.url));
  const result = spawnSync(
    "python3",
    ["-m", "unittest", "discover", "-s", source, "-p", "test_*.py"],
    { encoding: "utf8" },
  );
  expect(result.status, result.stderr).toBe(0);
});
