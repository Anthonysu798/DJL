import { createRequire } from "node:module";
import assert from "node:assert/strict";

import { describe, it } from "@effect/vitest";

interface Submission {
  readonly id: string;
}

interface SubmissionInfo {
  readonly status: string;
}

interface NotaryClient {
  readonly submit: () => Promise<Submission>;
  readonly info: (submissionId: string) => Promise<SubmissionInfo>;
  readonly log: (submissionId: string) => Promise<string>;
}

interface PollOptions {
  readonly client: NotaryClient;
  readonly sleep: (milliseconds: number) => Promise<void>;
  readonly now: () => number;
  readonly pollIntervalMs: number;
  readonly timeoutMs: number;
  readonly maxConsecutiveTransientErrors: number;
}

interface AppleNotarizationApi {
  readonly createNotaryToolClient?: (options: {
    readonly archivePath: string;
    readonly credentials: {
      readonly keyPath: string;
      readonly keyId: string;
      readonly issuer: string;
    };
    readonly runNotaryTool: (arguments_: readonly string[]) => Promise<string>;
  }) => NotaryClient;
  readonly submitAndPollNotarization?: (options: PollOptions) => Promise<Submission>;
}

interface AfterSignContext {
  readonly appOutDir: string;
  readonly electronPlatformName: string;
  readonly packager: { readonly appInfo: { readonly productFilename: string } };
}

interface AfterSignDependencies {
  readonly env: NodeJS.ProcessEnv;
  readonly makeTempDirectory: () => string;
  readonly removeTempDirectory: (path: string) => void;
  readonly runCommand: (
    command: string,
    arguments_: readonly string[],
  ) => Promise<{ readonly stdout: string }>;
  readonly sleep: (milliseconds: number) => Promise<void>;
  readonly now: () => number;
  readonly pollIntervalMs: number;
  readonly timeoutMs: number;
  readonly maxConsecutiveTransientErrors: number;
  readonly log: (message: string) => void;
}

interface AfterSignApi {
  readonly DEFAULT_TIMEOUT_MS?: number;
  readonly notarizeAfterSign?: (
    context: AfterSignContext,
    dependencies: AfterSignDependencies,
  ) => Promise<{ readonly id: string }>;
}

interface DmgNotarizationDependencies {
  readonly env: NodeJS.ProcessEnv;
  readonly runCommand: (
    command: string,
    arguments_: readonly string[],
  ) => Promise<{ readonly stdout: string }>;
  readonly sleep: (milliseconds: number) => Promise<void>;
  readonly now: () => number;
  readonly pollIntervalMs: number;
  readonly timeoutMs: number;
  readonly maxConsecutiveTransientErrors: number;
  readonly log: (message: string) => void;
}

interface DmgNotarizationApi {
  readonly notarizeDmg?: (
    dmgPath: string,
    dependencies: DmgNotarizationDependencies,
  ) => Promise<{ readonly id: string }>;
}

const require = createRequire(import.meta.url);

function loadAppleNotarizationApi(): AppleNotarizationApi {
  try {
    return require("./lib/apple-notarization.cjs") as AppleNotarizationApi;
  } catch {
    return {};
  }
}

function loadAfterSignApi(): AfterSignApi {
  try {
    return require("./notarize-macos-after-sign.cjs") as AfterSignApi;
  } catch {
    return {};
  }
}

function loadDmgNotarizationApi(): DmgNotarizationApi {
  try {
    return require("./notarize-macos-dmg.cjs") as DmgNotarizationApi;
  } catch {
    return {};
  }
}

function requireSubmitAndPoll() {
  const submitAndPoll = loadAppleNotarizationApi().submitAndPollNotarization;
  if (typeof submitAndPoll !== "function") {
    assert.fail("Expected submitAndPollNotarization to be exported.");
  }
  return submitAndPoll;
}

describe("submitAndPollNotarization", () => {
  it("submits once and retries transient polling errors against the same submission", async () => {
    const submitAndPoll = requireSubmitAndPoll();
    const submissionIds: string[] = [];
    const events: Array<SubmissionInfo | Error> = [
      { status: "In Progress" },
      new Error("HTTP 503"),
      { status: "In Progress" },
      { status: "Accepted" },
    ];
    let submits = 0;
    let now = 0;
    const result = await submitAndPoll({
      client: {
        submit: async () => {
          submits += 1;
          return { id: "submission-123" };
        },
        info: async (submissionId) => {
          submissionIds.push(submissionId);
          const event = events.shift();
          if (event instanceof Error) throw event;
          if (!event) throw new Error("Unexpected poll");
          return event;
        },
        log: async () => "",
      },
      sleep: async (milliseconds) => {
        now += milliseconds;
      },
      now: () => now,
      pollIntervalMs: 1_000,
      timeoutMs: 10_000,
      maxConsecutiveTransientErrors: 2,
    });

    assert.equal(submits, 1);
    assert.deepStrictEqual(submissionIds, [
      "submission-123",
      "submission-123",
      "submission-123",
      "submission-123",
    ]);
    assert.deepStrictEqual(result, { id: "submission-123" });
  });

  it("fails closed without resubmitting after repeated transient polling errors", async () => {
    const submitAndPoll = requireSubmitAndPoll();
    let submits = 0;
    const submissionIds: string[] = [];

    await assert.rejects(
      () =>
        submitAndPoll({
          client: {
            submit: async () => {
              submits += 1;
              return { id: "submission-456" };
            },
            info: async (submissionId) => {
              submissionIds.push(submissionId);
              throw new Error("connection reset");
            },
            log: async () => "",
          },
          sleep: async () => {},
          now: () => 0,
          pollIntervalMs: 1,
          timeoutMs: 10_000,
          maxConsecutiveTransientErrors: 2,
        }),
      /polling failed 3 consecutive times.*submission-456/i,
    );

    assert.equal(submits, 1);
    assert.deepStrictEqual(submissionIds, ["submission-456", "submission-456", "submission-456"]);
  });

  it("fails closed with Apple's log when the submission is invalid", async () => {
    const submitAndPoll = requireSubmitAndPoll();
    const loggedIds: string[] = [];

    await assert.rejects(
      () =>
        submitAndPoll({
          client: {
            submit: async () => ({ id: "submission-invalid" }),
            info: async () => ({ status: "Invalid" }),
            log: async (submissionId) => {
              loggedIds.push(submissionId);
              return '{"issues":[{"message":"signature invalid"}]}';
            },
          },
          sleep: async () => {},
          now: () => 0,
          pollIntervalMs: 1,
          timeoutMs: 10_000,
          maxConsecutiveTransientErrors: 2,
        }),
      /submission-invalid.*signature invalid/i,
    );

    assert.deepStrictEqual(loggedIds, ["submission-invalid"]);
  });

  it("fails closed on an unknown terminal status", async () => {
    const submitAndPoll = requireSubmitAndPoll();

    await assert.rejects(
      () =>
        submitAndPoll({
          client: {
            submit: async () => ({ id: "submission-unknown" }),
            info: async () => ({ status: "Unexpected" }),
            log: async () => "",
          },
          sleep: async () => {},
          now: () => 0,
          pollIntervalMs: 1,
          timeoutMs: 10_000,
          maxConsecutiveTransientErrors: 2,
        }),
      /unknown notarization status 'Unexpected'.*submission-unknown/i,
    );
  });

  it("fails closed when polling exceeds its total deadline", async () => {
    const submitAndPoll = requireSubmitAndPoll();
    let now = 0;

    await assert.rejects(
      () =>
        submitAndPoll({
          client: {
            submit: async () => ({ id: "submission-timeout" }),
            info: async () => ({ status: "In Progress" }),
            log: async () => "",
          },
          sleep: async (milliseconds) => {
            now += milliseconds;
          },
          now: () => now,
          pollIntervalMs: 1_000,
          timeoutMs: 2_000,
          maxConsecutiveTransientErrors: 2,
        }),
      /timed out.*submission-timeout/i,
    );
  });

  it("does not retry a failed submission whose ID is unknown", async () => {
    const submitAndPoll = requireSubmitAndPoll();
    let submits = 0;

    await assert.rejects(
      () =>
        submitAndPoll({
          client: {
            submit: async () => {
              submits += 1;
              throw new Error("upload response lost");
            },
            info: async () => ({ status: "Accepted" }),
            log: async () => "",
          },
          sleep: async () => {},
          now: () => 0,
          pollIntervalMs: 1,
          timeoutMs: 10_000,
          maxConsecutiveTransientErrors: 2,
        }),
      /upload response lost/,
    );

    assert.equal(submits, 1);
  });
});

describe("createNotaryToolClient", () => {
  it("submits without --wait, then polls and logs the returned submission ID", async () => {
    const createClient = loadAppleNotarizationApi().createNotaryToolClient;
    if (typeof createClient !== "function") {
      assert.fail("Expected createNotaryToolClient to be exported.");
    }
    const calls: string[][] = [];
    const outputs = [
      '{"id":"00000000-0000-0000-0000-000000000123"}',
      '{"status":"In Progress"}',
      '{"issues":[]}',
    ];
    const client = createClient({
      archivePath: "/tmp/DJL.zip",
      credentials: {
        keyPath: "/tmp/AuthKey.p8",
        keyId: "KEY123",
        issuer: "issuer-123",
      },
      runNotaryTool: async (arguments_) => {
        calls.push([...arguments_]);
        const output = outputs.shift();
        if (!output) throw new Error("Unexpected command");
        return output;
      },
    });

    const submission = await client.submit();
    await client.info(submission.id);
    await client.log(submission.id);

    assert.deepStrictEqual(calls, [
      [
        "submit",
        "/tmp/DJL.zip",
        "--no-wait",
        "--output-format",
        "json",
        "--key",
        "/tmp/AuthKey.p8",
        "--key-id",
        "KEY123",
        "--issuer",
        "issuer-123",
      ],
      [
        "info",
        "00000000-0000-0000-0000-000000000123",
        "--output-format",
        "json",
        "--key",
        "/tmp/AuthKey.p8",
        "--key-id",
        "KEY123",
        "--issuer",
        "issuer-123",
      ],
      [
        "log",
        "00000000-0000-0000-0000-000000000123",
        "--key",
        "/tmp/AuthKey.p8",
        "--key-id",
        "KEY123",
        "--issuer",
        "issuer-123",
      ],
    ]);
  });
});

describe("notarizeAfterSign", () => {
  it("allows Apple processing to remain queued for up to 24 hours", () => {
    assert.equal(loadAfterSignApi().DEFAULT_TIMEOUT_MS, 24 * 60 * 60 * 1_000);
  });

  it("archives, submits once, polls the same ID, then staples and validates the app", async () => {
    const notarizeAfterSign = loadAfterSignApi().notarizeAfterSign;
    if (typeof notarizeAfterSign !== "function") {
      assert.fail("Expected notarizeAfterSign to be exported.");
    }
    const commands: Array<{ command: string; arguments_: readonly string[] }> = [];
    const removed: string[] = [];
    const logs: string[] = [];
    const infoResponses = ['{"status":"In Progress"}', '{"status":"Accepted"}'];

    const result = await notarizeAfterSign(
      {
        appOutDir: "/tmp/build/mac-arm64",
        electronPlatformName: "darwin",
        packager: { appInfo: { productFilename: "DJL" } },
      },
      {
        env: {
          APPLE_API_KEY: "/tmp/AuthKey.p8",
          APPLE_API_KEY_ID: "KEY123",
          APPLE_API_ISSUER: "issuer-123",
        },
        makeTempDirectory: () => "/tmp/notarization-work",
        removeTempDirectory: (path) => {
          removed.push(path);
        },
        runCommand: async (command, arguments_) => {
          commands.push({ command, arguments_: [...arguments_] });
          if (command === "ditto") return { stdout: "" };
          if (arguments_[1] === "submit") {
            return { stdout: '{"id":"00000000-0000-0000-0000-000000000789"}' };
          }
          if (arguments_[1] === "info") {
            const stdout = infoResponses.shift();
            if (!stdout) throw new Error("Unexpected info poll");
            return { stdout };
          }
          return { stdout: "" };
        },
        sleep: async () => {},
        now: () => 0,
        pollIntervalMs: 1,
        timeoutMs: 10_000,
        maxConsecutiveTransientErrors: 2,
        log: (message) => {
          logs.push(message);
        },
      },
    );

    assert.deepStrictEqual(result, { id: "00000000-0000-0000-0000-000000000789" });
    assert.equal(commands.filter((command) => command.arguments_[1] === "submit").length, 1);
    assert.deepStrictEqual(
      commands
        .filter((command) => command.arguments_[1] === "info")
        .map((command) => command.arguments_[2]),
      ["00000000-0000-0000-0000-000000000789", "00000000-0000-0000-0000-000000000789"],
    );
    assert.deepStrictEqual(commands.at(0), {
      command: "ditto",
      arguments_: [
        "-c",
        "-k",
        "--sequesterRsrc",
        "--keepParent",
        "/tmp/build/mac-arm64/DJL.app",
        "/tmp/notarization-work/DJL.zip",
      ],
    });
    assert.deepStrictEqual(commands.slice(-2), [
      {
        command: "xcrun",
        arguments_: ["stapler", "staple", "--verbose", "/tmp/build/mac-arm64/DJL.app"],
      },
      {
        command: "xcrun",
        arguments_: ["stapler", "validate", "--verbose", "/tmp/build/mac-arm64/DJL.app"],
      },
    ]);
    assert.deepStrictEqual(removed, ["/tmp/notarization-work"]);
    assert.ok(
      logs.some((message) =>
        message.includes("Submitted signed app once as 00000000-0000-0000-0000-000000000789"),
      ),
    );
  });

  it("fails before submission when Apple credentials are incomplete", async () => {
    const notarizeAfterSign = loadAfterSignApi().notarizeAfterSign;
    if (typeof notarizeAfterSign !== "function") {
      assert.fail("Expected notarizeAfterSign to be exported.");
    }
    let commands = 0;

    await assert.rejects(
      () =>
        notarizeAfterSign(
          {
            appOutDir: "/tmp/build/mac",
            electronPlatformName: "darwin",
            packager: { appInfo: { productFilename: "DJL" } },
          },
          {
            env: {},
            makeTempDirectory: () => "/tmp/notarization-work",
            removeTempDirectory: () => {},
            runCommand: async () => {
              commands += 1;
              return { stdout: "" };
            },
            sleep: async () => {},
            now: () => 0,
            pollIntervalMs: 1,
            timeoutMs: 10_000,
            maxConsecutiveTransientErrors: 2,
            log: () => {},
          },
        ),
      /APPLE_API_KEY, APPLE_API_KEY_ID, APPLE_API_ISSUER/,
    );

    assert.equal(commands, 0);
  });
});

describe("notarizeDmg", () => {
  it("submits the DMG once, polls the same ID, then staples and validates it", async () => {
    const notarizeDmg = loadDmgNotarizationApi().notarizeDmg;
    if (typeof notarizeDmg !== "function") {
      assert.fail("Expected notarizeDmg to be exported.");
    }
    const commands: Array<{ command: string; arguments_: readonly string[] }> = [];
    const infoResponses = ['{"status":"In Progress"}', '{"status":"Accepted"}'];

    const result = await notarizeDmg("/tmp/DJL-0.5.2-x64.dmg", {
      env: {
        APPLE_API_KEY: "/tmp/AuthKey.p8",
        APPLE_API_KEY_ID: "KEY123",
        APPLE_API_ISSUER: "issuer-123",
      },
      runCommand: async (command, arguments_) => {
        commands.push({ command, arguments_: [...arguments_] });
        if (arguments_[1] === "submit") {
          return { stdout: '{"id":"dmg-submission-123"}' };
        }
        if (arguments_[1] === "info") {
          const stdout = infoResponses.shift();
          if (!stdout) throw new Error("Unexpected info poll");
          return { stdout };
        }
        return { stdout: "" };
      },
      sleep: async () => {},
      now: () => 0,
      pollIntervalMs: 1,
      timeoutMs: 10_000,
      maxConsecutiveTransientErrors: 2,
      log: () => {},
    });

    assert.deepStrictEqual(result, { id: "dmg-submission-123" });
    assert.equal(commands.filter((call) => call.arguments_[1] === "submit").length, 1);
    assert.deepStrictEqual(
      commands.filter((call) => call.arguments_[1] === "info").map((call) => call.arguments_[2]),
      ["dmg-submission-123", "dmg-submission-123"],
    );
    assert.deepStrictEqual(commands.slice(-2), [
      {
        command: "xcrun",
        arguments_: ["stapler", "staple", "--verbose", "/tmp/DJL-0.5.2-x64.dmg"],
      },
      {
        command: "xcrun",
        arguments_: ["stapler", "validate", "--verbose", "/tmp/DJL-0.5.2-x64.dmg"],
      },
    ]);
  });

  it("fails closed when stapling fails and never reports validation", async () => {
    const notarizeDmg = loadDmgNotarizationApi().notarizeDmg;
    if (typeof notarizeDmg !== "function") {
      assert.fail("Expected notarizeDmg to be exported.");
    }
    const commands: string[][] = [];

    await assert.rejects(
      () =>
        notarizeDmg("/tmp/DJL-0.5.2-arm64.dmg", {
          env: {
            APPLE_API_KEY: "/tmp/AuthKey.p8",
            APPLE_API_KEY_ID: "KEY123",
            APPLE_API_ISSUER: "issuer-123",
          },
          runCommand: async (_command, arguments_) => {
            commands.push([...arguments_]);
            if (arguments_[1] === "submit") return { stdout: '{"id":"dmg-submission-456"}' };
            if (arguments_[1] === "info") return { stdout: '{"status":"Accepted"}' };
            if (arguments_[1] === "staple") throw new Error("stapler failed");
            return { stdout: "" };
          },
          sleep: async () => {},
          now: () => 0,
          pollIntervalMs: 1,
          timeoutMs: 10_000,
          maxConsecutiveTransientErrors: 2,
          log: () => {},
        }),
      /stapler failed/,
    );

    assert.equal(
      commands.some((arguments_) => arguments_[1] === "validate"),
      false,
    );
  });
});
