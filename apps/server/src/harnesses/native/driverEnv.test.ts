import { describe, expect, it } from "vitest";

import { withDjlThreadId } from "./driverEnv";

describe("withDjlThreadId", () => {
  it("adds the thread id without mutating the base env", () => {
    const base = { PATH: "/bin", DJL_SSH_SHIM_URL: "http://127.0.0.1:1/x" };
    const env = withDjlThreadId(base, "thread-1");
    expect(env.DJL_THREAD_ID).toBe("thread-1");
    expect(env.PATH).toBe("/bin");
    expect(env.DJL_SSH_SHIM_URL).toBe(base.DJL_SSH_SHIM_URL);
    expect("DJL_THREAD_ID" in base).toBe(false);
  });

  it("leaves the env untagged when no thread is known", () => {
    expect(withDjlThreadId({ PATH: "/bin" }, undefined).DJL_THREAD_ID).toBeUndefined();
  });
});
