#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  resolveDesktopMediaTargets,
  smokeDesktopMedia,
  stageDesktopMedia,
  verifyDesktopMedia,
} from "./lib/desktop-media.ts";

async function main() {
  const args = process.argv.slice(2);
  const value = (flag: string, fallback?: string) => {
    const index = args.indexOf(flag);
    const result = index >= 0 ? args[index + 1] : fallback;
    if (!result || result.startsWith("--")) throw new Error(`Provide ${flag}.`);
    return result;
  };
  const platform = value("--platform", process.platform),
    arch = value("--arch", process.arch);
  const root = path.resolve(value("--root"));
  if (args.includes("--verify")) {
    for (const target of resolveDesktopMediaTargets(platform, arch)) {
      await verifyDesktopMedia(root, target, args.includes("--packaged"));
      console.log(JSON.stringify(await smokeDesktopMedia(root, target)));
    }
  } else {
    const cacheDir = path.resolve(value("--cache", ".cache/djl/media-tools"));
    console.log(
      JSON.stringify({
        staged: await stageDesktopMedia({ platform, arch, mediaRoot: root, cacheDir }),
      }),
    );
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Media staging failed.");
    process.exitCode = 1;
  });
}
