import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";

import { describe, it } from "@effect/vitest";
import { vi } from "vitest";

interface PackContext {
  readonly electronPlatformName: string;
  readonly appOutDir: string;
  readonly packager: { readonly appInfo: { readonly productFilename: string } };
}

interface Dependencies {
  readonly open: (file: string, flags: string) => Promise<{ close: () => Promise<void> }>;
  readonly sleep: (milliseconds: number) => Promise<void>;
}

const require = createRequire(import.meta.url);
const afterPack = require("./windows-after-pack.cjs") as (
  context: PackContext,
  dependencies: Dependencies,
) => Promise<void>;

const context = (platform = "win32"): PackContext => ({
  electronPlatformName: platform,
  appOutDir: join("private-stage", "win-unpacked"),
  packager: { appInfo: { productFilename: "DJL" } },
});

function fixture() {
  const close = vi.fn(async () => undefined);
  const open = vi.fn(async () => ({ close }));
  const sleep = vi.fn(async (_milliseconds: number) => undefined);
  return { close, open, sleep };
}

describe("Windows afterPack resource-write readiness", () => {
  it("leaves other platforms alone", async () => {
    const deps = fixture();
    for (const platform of ["darwin", "linux"]) await afterPack(context(platform), deps);
    assert.equal(deps.open.mock.calls.length, 0);
    assert.equal(deps.sleep.mock.calls.length, 0);
  });

  it("requires two non-truncating writable probes and closes both handles", async () => {
    const deps = fixture();
    await afterPack(context(), deps);
    assert.deepStrictEqual(deps.open.mock.calls, [
      [join(context().appOutDir, "DJL.exe"), "r+"],
      [join(context().appOutDir, "DJL.exe"), "r+"],
    ]);
    assert.equal(deps.close.mock.calls.length, 2);
    assert.deepStrictEqual(deps.sleep.mock.calls, [[250]]);
  });

  it("retries only transient EBUSY and restarts the consecutive-probe requirement", async () => {
    const deps = fixture();
    const busy = Object.assign(new Error("sharing violation"), { code: "EBUSY" });
    deps.open.mockResolvedValueOnce({ close: deps.close }).mockRejectedValueOnce(busy);
    await afterPack(context(), deps);
    assert.equal(deps.open.mock.calls.length, 4);
    assert.equal(deps.close.mock.calls.length, 3);
    assert.equal(deps.sleep.mock.calls.length, 3);
  });

  it("bounds persistent EBUSY to forty waits, then fails closed", async () => {
    const deps = fixture();
    const busy = Object.assign(new Error("still locked"), { code: "EBUSY" });
    deps.open.mockRejectedValue(busy);
    await assert.rejects(afterPack(context(), deps), (error) => error === busy);
    assert.equal(deps.open.mock.calls.length, 41);
    assert.equal(deps.close.mock.calls.length, 0);
    assert.equal(
      deps.sleep.mock.calls.reduce((total, [ms]) => total + ms, 0),
      10_000,
    );
  });

  it("does not conceal missing files, permission failures or other I/O errors", async () => {
    for (const code of ["ENOENT", "EACCES", "EPERM", "EIO"]) {
      const deps = fixture();
      const failure = Object.assign(new Error(code), { code });
      deps.open.mockRejectedValue(failure);
      await assert.rejects(afterPack(context(), deps), (error) => error === failure);
      assert.equal(deps.open.mock.calls.length, 1);
      assert.equal(deps.sleep.mock.calls.length, 0);
    }
  });

  it("propagates close failures instead of retrying and leaking a handle", async () => {
    const deps = fixture();
    const failure = Object.assign(new Error("close failed"), { code: "EBUSY" });
    deps.close.mockRejectedValue(failure);
    await assert.rejects(afterPack(context(), deps), (error) => error === failure);
    assert.equal(deps.open.mock.calls.length, 1);
    assert.equal(deps.sleep.mock.calls.length, 0);
  });
});
