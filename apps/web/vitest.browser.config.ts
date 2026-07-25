import { fileURLToPath } from "node:url";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig, mergeConfig } from "vitest/config";

import viteConfig from "./vite.config";

const srcPath = fileURLToPath(new URL("./src", import.meta.url));
const chromiumExecutablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;

export default mergeConfig(
  viteConfig,
  defineConfig({
    resolve: {
      alias: {
        "~": srcPath,
      },
    },
    test: {
      setupFiles: ["./src/test/browserSetup.ts"],
      include: [
        "src/components/**/*.browser.tsx",
        "src/lib/**/*.browser.ts",
        "src/lib/**/*.browser.tsx",
      ],
      browser: {
        enabled: true,
        provider: playwright(
          chromiumExecutablePath
            ? { launchOptions: { executablePath: chromiumExecutablePath } }
            : undefined,
        ),
        instances: [{ browser: "chromium" }],
        headless: true,
        fileParallelism: false,
      },
      testTimeout: 60_000,
      hookTimeout: 30_000,
    },
  }),
);
