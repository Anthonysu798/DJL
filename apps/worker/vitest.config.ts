import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
