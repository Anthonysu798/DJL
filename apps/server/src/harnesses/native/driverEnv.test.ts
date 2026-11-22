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

it("keeps the desktop computer broker credentials out of provider processes", () => {
  const base = {
    PATH: "/bin",
    DJL_COMPUTER_USE_BRIDGE_TOKEN: "private",
    DJL_CUA_HOST_SOCKET: "/private/tmp/fixture.sock",
    DJL_BROWSER_HOST_CAPABILITY: "private-cua-capability",
    DJL_BROWSER_HOST_CAPABILITY_FD: "9",
    DJL_AUTH_TOKEN: "private-backend-token",
    DJL_COMPUTER_USE_BRIDGE_URL: "http://127.0.0.1:1/computer-use",
  };
  expect(withDjlThreadId(base, "thread-1")).toEqual({ PATH: "/bin", DJL_THREAD_ID: "thread-1" });
  expect(withDjlThreadId(base, undefined)).toEqual({ PATH: "/bin" });
  expect(base.DJL_COMPUTER_USE_BRIDGE_TOKEN).toBe("private");
});
