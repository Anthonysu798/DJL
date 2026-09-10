import { fileURLToPath } from "node:url";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig, mergeConfig } from "vitest/config";

import viteConfig from "./vite.config";

const srcPath = fileURLToPath(new URL("./src", import.meta.url));
const chromiumExecutablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
const browserTestPort = process.env.DJL_BROWSER_TEST_PORT;

export default defineConfig((env) =>
  mergeConfig(
    viteConfig(env),
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
          // The browser server rereads this file separately from Vitest's CLI options.
          // Avoid inheriting the application's strict port when tests run concurrently.
          api: {
            ...(browserTestPort ? { port: Number(browserTestPort) } : {}),
            strictPort: false,
          },
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
  ),
);
