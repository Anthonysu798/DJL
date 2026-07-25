"use strict";

const { execFile } = require("node:child_process");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { promisify } = require("node:util");

const {
  createNotaryToolClient,
  submitAndPollNotarization,
} = require("./lib/apple-notarization.cjs");

const execFileAsync = promisify(execFile);
const DEFAULT_POLL_INTERVAL_MS = 20_000;
const DEFAULT_TIMEOUT_MS = 24 * 60 * 60 * 1_000;
const DEFAULT_MAX_CONSECUTIVE_TRANSIENT_ERRORS = 15;

function requiredCredentials(env) {
  const credentials = {
    keyPath: env.APPLE_API_KEY,
    keyId: env.APPLE_API_KEY_ID,
    issuer: env.APPLE_API_ISSUER,
  };
  if (!credentials.keyPath || !credentials.keyId || !credentials.issuer) {
    throw new Error(
      "Repository-owned notarization requires APPLE_API_KEY, APPLE_API_KEY_ID, APPLE_API_ISSUER.",
    );
  }
  return credentials;
}

async function runCommand(command, arguments_) {
  try {
    const result = await execFileAsync(command, arguments_, {
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    });
    return { stdout: result.stdout };
  } catch (cause) {
    const stderr =
      cause && typeof cause === "object" && typeof cause.stderr === "string"
        ? cause.stderr.trim()
        : "";
    const detail = stderr || (cause instanceof Error ? cause.message : String(cause));
    throw new Error(`${command} failed: ${detail}`, { cause });
  }
}

function defaultDependencies() {
  return {
    env: process.env,
    makeTempDirectory: () => mkdtempSync(join(tmpdir(), "djl-notarization-")),
    removeTempDirectory: (path) => rmSync(path, { recursive: true, force: true }),
    runCommand,
    sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    now: () => Date.now(),
    pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    maxConsecutiveTransientErrors: DEFAULT_MAX_CONSECUTIVE_TRANSIENT_ERRORS,
    log: (message) => console.log(`[desktop-notarization] ${message}`),
  };
}

async function notarizeAfterSign(context, dependencies = defaultDependencies()) {
  if (context.electronPlatformName !== "darwin") {
    throw new Error(
      `Repository-owned notarization expected darwin, got ${context.electronPlatformName}.`,
    );
  }
  const productFilename = context.packager?.appInfo?.productFilename;
  if (typeof productFilename !== "string" || productFilename.length === 0) {
    throw new Error("Electron Builder afterSign context is missing productFilename.");
  }

  const credentials = requiredCredentials(dependencies.env);
  const appPath = join(context.appOutDir, `${productFilename}.app`);
  const workDirectory = dependencies.makeTempDirectory();
  const archivePath = join(workDirectory, `${productFilename}.zip`);

  try {
    dependencies.log(`Archiving signed app at ${appPath}.`);
    await dependencies.runCommand("ditto", [
      "-c",
      "-k",
      "--sequesterRsrc",
      "--keepParent",
      appPath,
      archivePath,
    ]);

    const notaryToolClient = createNotaryToolClient({
      archivePath,
      credentials,
      runNotaryTool: async (arguments_) => {
        const result = await dependencies.runCommand("xcrun", ["notarytool", ...arguments_]);
        return result.stdout;
      },
    });
    const client = {
      ...notaryToolClient,
      submit: async () => {
        const submission = await notaryToolClient.submit();
        dependencies.log(`Submitted signed app once as ${submission.id}.`);
        return submission;
      },
    };
    const submission = await submitAndPollNotarization({
      client,
      sleep: dependencies.sleep,
      now: dependencies.now,
      pollIntervalMs: dependencies.pollIntervalMs,
      timeoutMs: dependencies.timeoutMs,
      maxConsecutiveTransientErrors: dependencies.maxConsecutiveTransientErrors,
    });

    dependencies.log(`Apple accepted submission ${submission.id}; stapling app.`);
    await dependencies.runCommand("xcrun", ["stapler", "staple", "--verbose", appPath]);
    await dependencies.runCommand("xcrun", ["stapler", "validate", "--verbose", appPath]);
    return submission;
  } finally {
    dependencies.removeTempDirectory(workDirectory);
  }
}

async function afterSign(context) {
  return notarizeAfterSign(context);
}

module.exports = afterSign;
module.exports.DEFAULT_TIMEOUT_MS = DEFAULT_TIMEOUT_MS;
module.exports.notarizeAfterSign = notarizeAfterSign;
