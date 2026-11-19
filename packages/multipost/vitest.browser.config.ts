import { defineConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";
export default defineConfig({
  test: {
    include: ["src/**/*.browser.ts"],
    browser: {
      enabled: true,
      provider: playwright(),
      instances: [{ browser: "chromium" }],
      headless: true,
      fileParallelism: false,
    },
    testTimeout: 15000,
  },
});
