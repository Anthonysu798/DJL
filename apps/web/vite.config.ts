// FILE: vite.config.ts
// Purpose: Builds the Synara web client and controls diagnostic source maps.
// Layer: Web build config
// Depends on: Vite, Tailwind, React compiler, TanStack Router.

import fs from "node:fs/promises";
import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import babel from "@rolldown/plugin-babel";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import { defineConfig, type Plugin } from "vite";
import pkg from "./package.json" with { type: "json" };

const port = Number(process.env.PORT ?? 5733);
const sourcemapEnv = process.env.SYNARA_WEB_SOURCEMAP?.trim().toLowerCase();

const buildSourcemap =
  sourcemapEnv === "1" || sourcemapEnv === "true"
    ? true
    : sourcemapEnv === "hidden"
      ? "hidden"
      : false;

const CENTRAL_ICON_DIR = "central-icons-reversed";
const CENTRAL_ICON_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx"]);

async function listFiles(root: string): Promise<string[]> {
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  const result: string[] = [];
  for (const entry of entries) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      result.push(...(await listFiles(entryPath)));
    } else if (entry.isFile()) {
      result.push(entryPath);
    }
  }
  return result;
}

// Finds literal icon basenames in source, then prunes the copied public icon set after build.
function centralIconPrunePlugin(): Plugin {
  let resolvedRoot = process.cwd();
  let resolvedOutDir = "dist";
  return {
    name: "synara-central-icon-prune",
    apply: "build",
    configResolved(config) {
      resolvedRoot = config.root;
      resolvedOutDir = path.resolve(config.root, config.build.outDir);
    },
    async closeBundle() {
      const publicIconDir = path.join(resolvedRoot, "public", CENTRAL_ICON_DIR);
      const distIconDir = path.join(resolvedOutDir, CENTRAL_ICON_DIR);
      const iconFiles = await fs.readdir(publicIconDir).catch(() => []);
      const availableIcons = new Set(
        iconFiles
          .filter((name) => name.endsWith(".svg"))
          .map((name) => name.slice(0, -".svg".length)),
      );
      if (availableIcons.size === 0) return;

      const sourceFiles = (await listFiles(path.join(resolvedRoot, "src"))).filter((file) =>
        SOURCE_EXTENSIONS.has(path.extname(file)),
      );
      const requiredIcons = new Set<string>();
      const literalPattern = /["'`]([a-z0-9][a-z0-9-]*)["'`]/g;
      for (const sourceFile of sourceFiles) {
        const source = await fs.readFile(sourceFile, "utf8").catch(() => "");
        for (const match of source.matchAll(literalPattern)) {
          const iconName = match[1];
          if (
            iconName &&
            CENTRAL_ICON_NAME_PATTERN.test(iconName) &&
            availableIcons.has(iconName)
          ) {
            requiredIcons.add(iconName);
          }
        }
      }

      if (requiredIcons.size === 0) return;
      const copiedIconFiles = await fs.readdir(distIconDir).catch(() => []);
      let removedCount = 0;
      await Promise.all(
        copiedIconFiles.map(async (fileName) => {
          if (!fileName.endsWith(".svg")) return;
          const iconName = fileName.slice(0, -".svg".length);
          if (requiredIcons.has(iconName)) return;
          removedCount += 1;
          await fs.rm(path.join(distIconDir, fileName), { force: true });
        }),
      );
      console.info(
        `[central-icons] kept ${requiredIcons.size}/${availableIcons.size} referenced SVGs, pruned ${removedCount}.`,
      );
    },
  };
}

export default defineConfig(({ command }) => ({
  plugins: [
    tanstackRouter({
      target: "react",
      autoCodeSplitting: true,
    }),
    react(),
    babel({
      // We need to be explicit about the parser options after moving to @vitejs/plugin-react v6.0.0
      // This is because the babel plugin only automatically parses typescript and jsx based on relative paths (e.g. "**/*.ts")
      // whereas the previous version of the plugin parsed all files with a .ts extension.
      // This is causing our packages/ directory to fail to parse, as they are not relative to the CWD.
      parserOpts: { plugins: ["typescript", "jsx"] },
      presets: [reactCompilerPreset()],
    }),
    tailwindcss(),
    centralIconPrunePlugin(),
  ],
  optimizeDeps: {
    include: [
      // Prebundle our named icon exports, not tens of MB of unused icon packs.
      ...(command === "serve"
        ? [
            "@tabler/icons-react",
            ...[
              "bs",
              "fa6",
              "fi",
              "go",
              "hi2",
              "io",
              "io5",
              "lu",
              "pi",
              "ri",
              "si",
              "tb",
              "vsc",
            ].map((pack) => `react-icons/${pack}`),
          ]
        : []),
      "@pierre/diffs",
      "@pierre/diffs/react",
      "@pierre/diffs/worker/worker.js",
      "react-icons/gr",
    ],
  },
  define: {
    // In dev mode, tell the web app where the WebSocket server lives
    "import.meta.env.VITE_WS_URL": JSON.stringify(process.env.VITE_WS_URL ?? ""),
    "import.meta.env.APP_VERSION": JSON.stringify(pkg.version),
  },
  resolve: {
    alias:
      command === "serve"
        ? [
            {
              find: /^(?:@tabler\/icons-react|react-icons\/(?:bs|fa6|fi|go|gr|hi2|io|io5|lu|pi|ri|si|tb|vsc))$/,
              replacement: path.resolve(import.meta.dirname, "dev/icons.mjs"),
            },
          ]
        : [],
    tsconfigPaths: true,
  },
  server: {
    port,
    strictPort: true,
    // Compile the shell while Electron/backend bundles are starting, instead
    // of paying the transform waterfall after the first window is created.
    warmup: {
      clientFiles: ["./src/main.tsx", "./src/components/Sidebar.tsx"],
    },
    hmr: {
      // Explicit config so Vite's HMR WebSocket connects reliably
      // inside Electron's BrowserWindow. Vite 8 uses console.debug for
      // connection logs — enable "Verbose" in DevTools to see them.
      protocol: "ws",
      host: "localhost",
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: buildSourcemap,
  },
}));
