"use strict";

const { execFile } = require("node:child_process");
const { resolve } = require("node:path");
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
    runCommand,
    sleep: (milliseconds) => new Promise((complete) => setTimeout(complete, milliseconds)),
    now: () => Date.now(),
    pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    maxConsecutiveTransientErrors: DEFAULT_MAX_CONSECUTIVE_TRANSIENT_ERRORS,
    log: (message) => console.log(`[desktop-notarization] ${message}`),
  };
}

async function notarizeDmg(dmgPath, dependencies = defaultDependencies()) {
  if (typeof dmgPath !== "string" || dmgPath.length === 0 || !dmgPath.endsWith(".dmg")) {
    throw new Error("Repository-owned DMG notarization requires a .dmg path.");
  }
  const credentials = requiredCredentials(dependencies.env);
  const notaryToolClient = createNotaryToolClient({
    archivePath: dmgPath,
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
      dependencies.log(`Submitted DMG once as ${submission.id}: ${dmgPath}`);
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

  dependencies.log(`Apple accepted DMG submission ${submission.id}; stapling.`);
  await dependencies.runCommand("xcrun", ["stapler", "staple", "--verbose", dmgPath]);
  await dependencies.runCommand("xcrun", ["stapler", "validate", "--verbose", dmgPath]);
  return submission;
}

async function main(arguments_) {
  if (arguments_.length !== 1 || !arguments_[0]) {
    throw new Error("Usage: node scripts/notarize-macos-dmg.cjs <path-to-dmg>");
  }
  await notarizeDmg(resolve(arguments_[0]));
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((cause) => {
    console.error(cause instanceof Error ? cause.stack || cause.message : String(cause));
    process.exitCode = 1;
  });
}

module.exports = {
  DEFAULT_TIMEOUT_MS,
  notarizeDmg,
};
