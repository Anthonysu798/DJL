#!/usr/bin/env bun

import { resolve } from "node:path";
import { prepareVendoredOpenCode } from "./lib/vendored-opencode";

const platformArg = process.argv.find((value) => value.startsWith("--platform="))?.split("=")[1] as
  | "darwin"
  | "linux"
  | "win32"
  | undefined;
const archArg = process.argv.find((value) => value.startsWith("--arch="))?.split("=")[1] as
  | "arm64"
  | "x64"
  | undefined;

const binary = prepareVendoredOpenCode({
  repoRoot: resolve(import.meta.dir, ".."),
  ...(platformArg ? { platform: platformArg } : {}),
  ...(archArg ? { arch: archArg } : {}),
});
process.stdout.write(`${binary}\n`);
