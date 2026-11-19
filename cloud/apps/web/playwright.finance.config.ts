import { isAbsolute, join } from "node:path";

import { defineConfig } from "@playwright/test";

const dir = process.env.DJL_FINANCE_E2E_DIR;
const executablePath = process.env.DJL_FINANCE_E2E_CHROMIUM;
if (process.env.DJL_FINANCE_E2E !== "1" || !dir || !isAbsolute(dir)) {
  throw new Error("Use DJL_FINANCE_E2E=1 with an absolute, unique DJL_FINANCE_E2E_DIR.");
}
if (executablePath && !isAbsolute(executablePath)) {
  throw new Error("DJL_FINANCE_E2E_CHROMIUM must be an absolute executable path.");
}

// The operator owns the isolated TEST services and fixture lifecycle. Never start or reuse a webServer here.
export default defineConfig({
  testDir: "./finance-e2e",
  testMatch: "finance.spec.ts",
  timeout: 90_000,
  expect: { timeout: 8_000 },
  workers: 1,
  retries: 0,
  forbidOnly: true,
  reporter: [["list"]],
  outputDir: join(dir, "playwright-output"),
  preserveOutput: "never",
  use: {
    browserName: "chromium",
    headless: true,
    trace: "off",
    screenshot: "off",
    video: "off",
    launchOptions: {
      chromiumSandbox: true,
      ...(executablePath ? { executablePath } : {}),
      args: [
        "--disable-background-networking",
        "--disable-component-update",
        "--no-proxy-server",
        "--host-resolver-rules=MAP localhost 127.0.0.1, MAP * ~NOTFOUND",
      ],
    },
  },
});
