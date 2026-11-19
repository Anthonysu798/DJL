import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { computerUsePauseDeadline } from "./computerUsePauseDeadline";

// Each subprocess owns its timezone; no worker/global timezone mutation leaks.
describe("host pause local calendar", () => {
  it("uses exact elapsed durations independent of local calendar transitions", () => {
    const now = Date.parse("2026-03-08T06:45:00.000Z");
    expect(computerUsePauseDeadline("30m", now)).toBe("2026-03-08T07:15:00.000Z");
    expect(computerUsePauseDeadline("1h", now)).toBe("2026-03-08T07:45:00.000Z");
  });
  it.each([
    ["America/Toronto", "2026-03-07T17:00:00.000Z", "2026-03-08T13:00:00.000Z"],
    ["America/Toronto", "2026-10-31T16:00:00.000Z", "2026-11-01T14:00:00.000Z"],
    ["America/Toronto", "2026-12-31T17:00:00.000Z", "2027-01-01T14:00:00.000Z"],
    ["America/Toronto", "2026-01-31T17:00:00.000Z", "2026-02-01T14:00:00.000Z"],
    ["Asia/Kathmandu", "2026-10-28T06:15:00.000Z", "2026-10-29T03:15:00.000Z"],
    // Samoa skipped 2011-12-30: compatible resolution advances to Dec 31 09:00.
    ["Pacific/Apia", "2011-12-29T22:00:00.000Z", "2011-12-30T19:00:00.000Z"],
  ])("computes next local calendar day at09 in %s from %s", (zone, now, expected) => {
    const source = readFileSync(new URL("./computerUsePauseDeadline.ts", import.meta.url), "utf8");
    const script = `${source}\nprocess.stdout.write(computerUsePauseDeadline("tomorrow09", Date.parse(${JSON.stringify(now)})));`;
    const output = execFileSync(
      process.execPath,
      ["--input-type=module-typescript", "-e", script],
      { env: { ...process.env, TZ: zone }, encoding: "utf8", timeout: 5000 },
    );
    expect(output).toBe(expected);
  });
});
