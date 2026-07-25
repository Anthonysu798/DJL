"use strict";

function errorMessage(cause) {
  return cause instanceof Error ? cause.message : String(cause);
}

function validatePollingOptions(options) {
  if (!Number.isFinite(options.pollIntervalMs) || options.pollIntervalMs <= 0) {
    throw new Error("Notarization pollIntervalMs must be positive.");
  }
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new Error("Notarization timeoutMs must be positive.");
  }
  if (
    !Number.isInteger(options.maxConsecutiveTransientErrors) ||
    options.maxConsecutiveTransientErrors < 0
  ) {
    throw new Error("Notarization maxConsecutiveTransientErrors must be a non-negative integer.");
  }
}

async function readRejectionLog(client, submissionId) {
  try {
    return await client.log(submissionId);
  } catch (cause) {
    return `Notarization log unavailable: ${errorMessage(cause)}`;
  }
}

async function submitAndPollNotarization(options) {
  validatePollingOptions(options);
  const submission = await options.client.submit();
  if (!submission || typeof submission.id !== "string" || submission.id.length === 0) {
    throw new Error("Apple notarization submission did not return a submission ID.");
  }

  const submissionId = submission.id;
  const startedAt = options.now();
  let consecutiveTransientErrors = 0;

  while (true) {
    if (options.now() - startedAt >= options.timeoutMs) {
      throw new Error(
        `Apple notarization polling timed out for submission ${submissionId} after ${options.timeoutMs}ms.`,
      );
    }

    let status;
    try {
      const info = await options.client.info(submissionId);
      if (!info || typeof info.status !== "string" || info.status.length === 0) {
        throw new Error("Apple notarization info response did not include a status.");
      }
      status = info.status;
      consecutiveTransientErrors = 0;
    } catch (cause) {
      consecutiveTransientErrors += 1;
      if (consecutiveTransientErrors > options.maxConsecutiveTransientErrors) {
        throw new Error(
          `Apple notarization polling failed ${consecutiveTransientErrors} consecutive times for submission ${submissionId}: ${errorMessage(cause)}`,
          { cause },
        );
      }
      await options.sleep(options.pollIntervalMs);
      continue;
    }

    if (status === "Accepted") {
      return { id: submissionId };
    }
    if (status === "In Progress") {
      await options.sleep(options.pollIntervalMs);
      continue;
    }
    if (status === "Invalid" || status === "Rejected") {
      const log = await readRejectionLog(options.client, submissionId);
      throw new Error(
        `Apple notarization submission ${submissionId} finished with status '${status}'. ${log}`,
      );
    }
    throw new Error(
      `Unknown notarization status '${status}' for submission ${submissionId}; refusing to continue.`,
    );
  }
}

function parseJsonResponse(raw, operation) {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      throw new Error("response is not an object");
    }
    return parsed;
  } catch (cause) {
    throw new Error(`Could not parse notarytool ${operation} JSON: ${errorMessage(cause)}`, {
      cause,
    });
  }
}

function createNotaryToolClient(options) {
  const authArguments = [
    "--key",
    options.credentials.keyPath,
    "--key-id",
    options.credentials.keyId,
    "--issuer",
    options.credentials.issuer,
  ];

  return {
    submit: async () => {
      const raw = await options.runNotaryTool([
        "submit",
        options.archivePath,
        "--no-wait",
        "--output-format",
        "json",
        ...authArguments,
      ]);
      const response = parseJsonResponse(raw, "submit");
      if (typeof response.id !== "string" || response.id.length === 0) {
        throw new Error("notarytool submit response did not include a submission ID.");
      }
      return { id: response.id };
    },
    info: async (submissionId) => {
      const raw = await options.runNotaryTool([
        "info",
        submissionId,
        "--output-format",
        "json",
        ...authArguments,
      ]);
      const response = parseJsonResponse(raw, "info");
      if (typeof response.status !== "string" || response.status.length === 0) {
        throw new Error("notarytool info response did not include a status.");
      }
      return { status: response.status };
    },
    log: (submissionId) => options.runNotaryTool(["log", submissionId, ...authArguments]),
  };
}

module.exports = {
  createNotaryToolClient,
  submitAndPollNotarization,
};
