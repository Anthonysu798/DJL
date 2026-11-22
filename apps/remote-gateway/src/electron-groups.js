// FILE: electron-groups.js
// Purpose: Gives the paired phone DJL Multi agents groups: forwards the desktop's group event stream, maps djl/groups/* requests onto the backend, and moves group attachments in relay-sized pieces.
// Layer: CLI helper
// Exports: createElectronGroups
// Depends on: nothing

const GROUPS = {
  list: "groups.list",
  create: "groups.create",
  update: "groups.update",
  stopMember: "groups.stopMember",
  resolvePause: "groups.resolvePause",
  subscribe: "groups.subscribe",
};
const HARNESSES_LIST_ACCOUNTS = "harnesses.listAccounts";
// The desktop's member kinds and their names (GROUP_MEMBER_PROVIDERS and
// PROVIDER_DISPLAY_NAMES in packages/contracts), in the desktop's order.
const GROUP_MEMBER_AGENTS = [
  ["codex", "Codex"],
  ["claudeAgent", "Claude"],
  ["cursor", "Cursor"],
  ["grok", "Grok"],
  ["kimi", "Kimi Code"],
  ["iflow", "iFlow"],
  ["qwen", "Qwen Code"],
  ["codebuddy", "CodeBuddy Code"],
  ["pi", "Pi"],
  ["gemini", "Gemini"],
];

// Attachments. The relay caps every message at 1 MiB, so files travel as
// base64 pieces: the phone sends 384 KiB per upload chunk and gets 384 KiB per
// download chunk. Limits match the desktop's streaming upload contract.
const MAX_FILE_BYTES = 100 * 1024 * 1024; // STREAMING_UPLOAD_MAX_FILE_BYTES
const MAX_ATTACHMENTS = 20; // STREAMING_UPLOAD_MAX_FILES_PER_TURN
const UPLOAD_CHUNK_MAX_BYTES = 512 * 1024;
const DOWNLOAD_CHUNK_BYTES = 384 * 1024;
const UPLOAD_IDLE_MS = 10 * 60 * 1000;
const DOWNLOAD_CACHE_MS = 5 * 60 * 1000;
const DOWNLOAD_CACHE_MAX_BYTES = 200 * 1024 * 1024;
const UPLOAD_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const ATTACHMENT_ID_PATTERN = /^[a-z0-9_-]{1,128}$/i;
const CONTENT_HASH_PATTERN = /^[a-f0-9]{64}$/i;
const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;
const NO_ENDPOINT_MESSAGE = "Attachments need the DJL desktop app.";

// `request` and `subscribe` talk to the backend, `emit` sends a phone
// notification, and `dispatchCommand` / `findThread` are the adapter's own
// orchestration helpers, so a group message is dispatched like any other turn.
// `endpoint` is the backend capability URL (null when the adapter was given a
// backend directly); attachment HTTP calls use `fetchImpl` against it.
function createElectronGroups({
  request,
  subscribe,
  emit,
  dispatchCommand,
  findThread,
  now,
  endpoint = null,
  fetchImpl = (url, init) => fetch(url, init),
}) {
  let unsubscribe = null;
  const uploads = new Map();
  const downloads = new Map();

  function start() {
    if (unsubscribe) return;
    unsubscribe = subscribe(
      GROUPS.subscribe,
      {},
      {
        onChunk(values) {
          for (const value of values) forward(value);
        },
        onEnd() {
          unsubscribe = null;
        },
        onError() {
          // Resubscribing delivers a fresh snapshot first, so the phone resyncs.
          unsubscribe = null;
          start();
        },
      },
    );
  }

  function stop() {
    unsubscribe?.();
    unsubscribe = null;
    uploads.clear();
    downloads.clear();
  }

  // Drafts get their own method so the outbound coalescer can merge a burst.
  function forward(event) {
    if (!event || typeof event !== "object") return;
    if (event.type === "reply.draft") {
      emit("djl/groups/draft", {
        groupId: event.groupId,
        memberId: event.memberId,
        delta: event.delta,
        restart: event.restart,
      });
      return;
    }
    emit("djl/groups/event", event);
  }

  async function groupThreadId(groupId) {
    const { groups } = await request(GROUPS.list, {});
    const group = groups.find((entry) => entry.id === groupId);
    if (!group) throw new Error("Group not found");
    return group.threadId;
  }

  // Ready means the same as in the desktop's group setup dialog: the agent's
  // account status is "ready". Ready agents come first, as they do there.
  async function listAgents() {
    const { accounts } = await request(HARNESSES_LIST_ACCOUNTS, {});
    const agents = GROUP_MEMBER_AGENTS.map(([provider, displayName]) => ({
      provider,
      displayName,
      ready: accounts.some((account) => account.id === provider && account.status === "ready"),
    }));
    return { agents: [...agents.filter((a) => a.ready), ...agents.filter((a) => !a.ready)] };
  }

  // The same command the desktop's group composer sends: a message sent while
  // a round is running joins it instead of waiting for it to end.
  async function send(params, mutation) {
    const text = typeof params.text === "string" ? params.text.trim() : "";
    const attachments = readAttachmentReferences(params.attachments);
    if (!text && attachments.length === 0) throw new Error("A message is required.");
    const threadId = await groupThreadId(params.groupId);
    const thread = await findThread(threadId);
    await dispatchCommand(
      {
        type: "thread.turn.start",
        commandId: mutation.commandId("group-send"),
        threadId,
        message: {
          messageId: mutation.entityId("djl-message", "message"),
          role: "user",
          text,
          attachments,
        },
        modelSelection: { provider: "group", model: "group" },
        dispatchMode: thread?.session?.status === "running" ? "steer" : "queue",
        runtimeMode: "approval-required",
        interactionMode: "default",
        createdAt: now(),
      },
      mutation,
    );
    return {};
  }

  async function stopAll(params, mutation) {
    await dispatchCommand(
      {
        type: "thread.turn.interrupt",
        commandId: mutation.commandId("group-stop"),
        threadId: await groupThreadId(params.groupId),
        createdAt: now(),
      },
      mutation,
    );
    return {};
  }

  // One upload chunk. Chunks arrive in order; the final one hands the
  // assembled file to the desktop, which stores it on the group's thread.
  async function upload(params) {
    const http = backendHttp();
    expireUploads();
    const uploadId = readUploadId(params.uploadId);
    const offset = params.offset;
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("Invalid upload offset.");
    const chunk = decodeChunk(params.data);
    let entry = uploads.get(uploadId);
    if (offset === 0) {
      entry = {
        groupId: params.groupId,
        name: readAttachmentName(params.name),
        mimeType: readMimeType(params.mimeType),
        sizeBytes: readSizeBytes(params.sizeBytes),
        chunks: [],
        received: 0,
        touchedAt: 0,
      };
      uploads.set(uploadId, entry);
    }
    if (!entry || offset !== entry.received) throw new Error("Upload out of order");
    if (entry.received + chunk.length > entry.sizeBytes) {
      uploads.delete(uploadId);
      throw new Error("Upload is larger than its declared size.");
    }
    entry.chunks.push(chunk);
    entry.received += chunk.length;
    entry.touchedAt = Date.now();
    if (params.final !== true) return { received: entry.received };

    uploads.delete(uploadId);
    if (entry.received !== entry.sizeBytes) throw new Error("Upload is incomplete.");
    const threadId = await groupThreadId(entry.groupId);
    const response = await http("/api/attachments/upload", {
      method: "POST",
      query: { threadId, name: entry.name, mimeType: entry.mimeType, sizeBytes: entry.sizeBytes },
      body: Buffer.concat(entry.chunks, entry.received),
    });
    if (!response.ok) throw new Error(await failureMessage(response, "Upload failed"));
    return { attachment: readAttachmentReference(await response.json()) };
  }

  function expireUploads() {
    const cutoff = Date.now() - UPLOAD_IDLE_MS;
    for (const [uploadId, entry] of uploads) if (entry.touchedAt < cutoff) uploads.delete(uploadId);
  }

  // One download chunk of a stored attachment, for previews in group history.
  async function attachment(params) {
    const http = backendHttp();
    const attachmentId = params.attachmentId;
    if (typeof attachmentId !== "string" || !ATTACHMENT_ID_PATTERN.test(attachmentId)) {
      throw new Error("Invalid attachment id.");
    }
    const offset = params.offset ?? 0;
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("Invalid attachment offset.");
    const { bytes, mimeType } = await cachedAttachment(http, attachmentId);
    if (offset > bytes.length) throw new Error("Invalid attachment offset.");
    const end = Math.min(offset + DOWNLOAD_CHUNK_BYTES, bytes.length);
    return {
      data: bytes.subarray(offset, end).toString("base64"),
      offset,
      sizeBytes: bytes.length,
      mimeType,
      done: end >= bytes.length,
    };
  }

  // The phone pages through a file in many requests, so the bytes are fetched
  // once and kept briefly. Map order is age order, oldest evicted first.
  async function cachedAttachment(http, attachmentId) {
    const time = Date.now();
    for (const [id, entry] of downloads) if (entry.expiresAt <= time) downloads.delete(id);
    let entry = downloads.get(attachmentId);
    if (!entry) {
      entry = { promise: fetchAttachment(http, attachmentId), sizeBytes: 0, expiresAt: 0 };
      downloads.set(attachmentId, entry);
      entry.promise.then(
        (file) => {
          entry.sizeBytes = file.bytes.length;
          evictDownloads(attachmentId);
        },
        () => {
          if (downloads.get(attachmentId) === entry) downloads.delete(attachmentId);
        },
      );
    }
    entry.expiresAt = time + DOWNLOAD_CACHE_MS;
    return entry.promise;
  }

  function evictDownloads(keepId) {
    let total = 0;
    for (const entry of downloads.values()) total += entry.sizeBytes;
    for (const [id, entry] of downloads) {
      if (total <= DOWNLOAD_CACHE_MAX_BYTES) return;
      if (id === keepId) continue;
      total -= entry.sizeBytes;
      downloads.delete(id);
    }
  }

  async function fetchAttachment(http, attachmentId) {
    const response = await http(`/attachments/${attachmentId}`, { method: "GET" });
    if (response.status === 404) throw new Error("Attachment not found.");
    if (!response.ok) throw new Error(await failureMessage(response, "Attachment download failed"));
    const contentType = response.headers.get("content-type") || "";
    return {
      bytes: Buffer.from(await response.arrayBuffer()),
      mimeType: contentType.split(";")[0].trim() || "application/octet-stream",
    };
  }

  // HTTP routes share the WebSocket endpoint's origin and one-time token. The
  // URL is never logged or put in an error, since it carries that token.
  function backendHttp() {
    if (!endpoint) throw new Error(NO_ENDPOINT_MESSAGE);
    return async (pathname, { method, query = {}, body }) => {
      const url = new URL(endpoint);
      if (url.protocol === "ws:") url.protocol = "http:";
      else if (url.protocol === "wss:") url.protocol = "https:";
      url.pathname = pathname;
      for (const [key, value] of Object.entries(query)) url.searchParams.set(key, String(value));
      try {
        return await fetchImpl(url.toString(), {
          method,
          ...(body ? { headers: { "Content-Type": "application/octet-stream" }, body } : {}),
        });
      } catch {
        throw new Error("Could not reach the DJL desktop app.");
      }
    };
  }

  // Returns undefined for a method that is not a group method.
  function handleRequest(method, params, mutation) {
    switch (method) {
      case "djl/groups/list":
        return request(GROUPS.list, {});
      case "djl/groups/agents":
        return listAgents();
      case "djl/groups/create":
        return request(GROUPS.create, { name: params.name, members: params.members });
      case "djl/groups/send":
        return send(params, mutation);
      case "djl/groups/upload":
        return upload(params);
      case "djl/groups/attachment":
        return attachment(params);
      case "djl/groups/stop":
        return stopAll(params, mutation);
      case "djl/groups/stopMember":
        return request(GROUPS.stopMember, {
          groupId: params.groupId,
          memberId: params.memberId,
        }).then(() => ({}));
      case "djl/groups/resolvePause":
        return request(GROUPS.resolvePause, {
          groupId: params.groupId,
          action: params.action,
          continueText: params.continueText,
        }).then(() => ({}));
      case "djl/groups/setSkipAllWarning":
        return request(GROUPS.update, {
          groupId: params.groupId,
          skipAllWarning: params.skipAllWarning,
        });
      default:
        return undefined;
    }
  }

  return { start, stop, handleRequest };
}

function readUploadId(value) {
  if (typeof value !== "string" || !UPLOAD_ID_PATTERN.test(value)) {
    throw new Error("Invalid upload id.");
  }
  return value;
}

function readAttachmentName(value) {
  if (!isAttachmentName(value)) throw new Error("Invalid attachment name.");
  return value;
}

function readMimeType(value) {
  if (!isMimeType(value)) throw new Error("Invalid attachment MIME type.");
  return value;
}

function readSizeBytes(value) {
  if (!isFileSize(value)) throw new Error("Attachment is empty or larger than 100 MB.");
  return value;
}

// The desktop upload route's own name rule.
function isAttachmentName(value) {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= 255 &&
    !value.includes("/") &&
    !value.includes("\\") &&
    !value.includes("\0")
  );
}

function isMimeType(value) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 100;
}

function isFileSize(value) {
  return Number.isSafeInteger(value) && value >= 1 && value <= MAX_FILE_BYTES;
}

function decodeChunk(data) {
  const maxChars = Math.ceil(UPLOAD_CHUNK_MAX_BYTES / 3) * 4;
  if (typeof data !== "string" || data.length > maxChars || !BASE64_PATTERN.test(data)) {
    throw new Error("Invalid upload chunk.");
  }
  const chunk = Buffer.from(data, "base64");
  if (chunk.length > UPLOAD_CHUNK_MAX_BYTES) throw new Error("Invalid upload chunk.");
  return chunk;
}

function readAttachmentReferences(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > MAX_ATTACHMENTS) {
    throw new Error(`Send at most ${MAX_ATTACHMENTS} attachments.`);
  }
  return value.map(readAttachmentReference);
}

// A StreamingAttachmentReference, checked like the desktop's schema and copied
// field by field so nothing else reaches the command.
function readAttachmentReference(value) {
  const reference = value && typeof value === "object" ? value : {};
  const { type, id, name, mimeType, sizeBytes, contentHash, uploadMethod } = reference;
  if (
    (type !== "image" && type !== "file") ||
    typeof id !== "string" ||
    !ATTACHMENT_ID_PATTERN.test(id) ||
    !isAttachmentName(name) ||
    !isMimeType(mimeType) ||
    (type === "image" && !/^image\//i.test(mimeType)) ||
    !isFileSize(sizeBytes) ||
    typeof contentHash !== "string" ||
    !CONTENT_HASH_PATTERN.test(contentHash) ||
    uploadMethod !== "stream"
  ) {
    throw new Error("Invalid attachment.");
  }
  return { type, id, name, mimeType, sizeBytes, contentHash, uploadMethod };
}

async function failureMessage(response, prefix) {
  const detail = await response.text().catch(() => "");
  const reason = detail.trim().slice(0, 200);
  return reason ? `${prefix}: ${reason}` : `${prefix} (${response.status}).`;
}

module.exports = { createElectronGroups };
