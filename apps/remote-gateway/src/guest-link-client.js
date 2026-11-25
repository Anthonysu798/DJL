// FILE: guest-link-client.js
// Purpose: The phone side of DJL Remote, in Node: pairs with another person's gateway through the
//          relay (pairing code, then trusted reconnects), runs the E2EE handshake, and carries
//          encrypted JSON-RPC messages both ways. Mirrors apps/mobile remote_transport.dart and
//          pairing_repository.dart so the gateway cannot tell it from a phone.
// Layer: CLI helper
// Exports: createGuestLinkClient
// Depends on: fs, path, crypto, ws, @djl/remote-protocol

const fs = require("fs");
const path = require("path");
const {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  timingSafeEqual,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  randomUUID,
  sign,
  verify,
} = require("crypto");
const {
  DJL_CLIENT_AUTH_LABEL,
  DJL_PAIRING_PROOF_MAC_LABEL,
  DJL_PAIRING_PROOF_PHONE_LABEL,
  DJL_PAIRING_QR_VERSION,
  DJL_SECURE_HANDSHAKE_TAG,
  DJL_SECURE_PROTOCOL_VERSION,
  buildHandshakeTranscript,
  buildPairingProofInput,
  buildRelayPhoneConnectTranscript,
  buildTrustedSessionResolveTranscript,
  secureNonce,
} = require("@djl/remote-protocol");
const { derivePairingCodeKeys } = require("./qr");

const STATE_FILE = "guest-link.json";
const PAIRING_CODE_PATTERN = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{10}$/;
const LOCAL_RELAY_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const HANDSHAKE_TIMEOUT_MS = 12_000;
const RESOLVE_TIMEOUT_MS = 8_000;
const PING_INTERVAL_MS = 20_000;
const RETRY_BASE_MS = 1_000;
const RETRY_MAX_MS = 15_000;
// Relay close codes the phone treats as final: replaced by a newer phone, revoked, frame too big.
const REFUSED_CLOSE_CODES = new Set([4001, 4005, 4009]);
// Host secureError codes that mean "this client is not (or no longer) welcome".
const REFUSED_SECURE_ERRORS = new Set([
  "phone_not_trusted",
  "phone_identity_changed",
  "pairing_expired",
  "update_required",
  "invalid_phone_signature",
]);
// Relay answers that mean "the host is not there right now", never a rejection.
const OFFLINE_RESOLVE_CODES = new Set([
  "session_unavailable",
  "mac_offline",
  "host_offline",
  "resolve_request_replayed",
  "resolve_request_expired",
]);

class LinkFailure extends Error {
  constructor(message, refused) {
    super(message);
    this.refused = refused;
  }
}
const refuse = (message) => new LinkFailure(message, true);
const unreachable = (message) => new LinkFailure(message, false);

function createGuestLinkClient({
  stateDir,
  relayUrl,
  code,
  onMessage = () => {},
  onStatus = () => {},
  WebSocketImpl = require("ws"),
  fetchImpl = globalThis.fetch,
  now = Date.now,
  setTimer = setTimeout,
}) {
  const statePath = path.join(stateDir, STATE_FILE);
  let state = null;
  let pendingCode = code;
  let running = false;
  let generation = 0;
  let link = null;
  let failures = 0;
  let lastStatus = null;
  // Replay cursor for this process: which host output was already delivered.
  const cursor = { sessionId: null, seq: 0, epoch: null };

  function report(nextState, error) {
    if (lastStatus === nextState && !error) return;
    lastStatus = nextState;
    onStatus({ state: nextState, hostName: hostName(), ...(error ? { error } : {}) });
  }

  function hostName() {
    return state?.host?.displayName || null;
  }

  function start() {
    if (running) return;
    running = true;
    generation += 1;
    try {
      state = loadState(statePath) ?? { version: 1, device: createDeviceIdentity(), host: null };
      saveState(statePath, state);
    } catch (error) {
      running = false;
      report("refused", `The link state could not be read: ${error.message}`);
      return;
    }
    report("connecting");
    void attempt(generation);
  }

  function stop() {
    running = false;
    generation += 1;
    closeLink(1000);
  }

  function forget() {
    stop();
    fs.rmSync(statePath, { force: true });
    state = null;
  }

  function send(message) {
    if (!link?.ready || link.socket.readyState !== WebSocketImpl.OPEN) return false;
    const counter = link.nextOutboundCounter;
    link.nextOutboundCounter += 1;
    link.socket.send(
      JSON.stringify(
        encryptEnvelope(
          { payloadText: JSON.stringify(message) },
          link.keys.phoneToMac,
          counter,
          link.target.sessionId,
          link.keyEpoch,
        ),
      ),
    );
    return true;
  }

  async function attempt(gen) {
    let target;
    try {
      target = state.host ? await resolveTrusted() : await resolveCode();
    } catch (error) {
      if (gen === generation) fail(error);
      return;
    }
    if (gen !== generation) return;
    openLink(target, gen);
  }

  async function resolveCode() {
    if (!pendingCode) throw refuse("A pairing code is needed to link to this computer.");
    const normalized = String(pendingCode).toUpperCase().replace(/[\s-]/g, "");
    if (!PAIRING_CODE_PATTERN.test(normalized)) throw refuse("The pairing code is not valid.");
    let relay;
    try {
      relay = new URL(String(relayUrl ?? "").trim());
      if (relay.protocol === "https:" || relay.protocol === "http:") {
        relay.protocol = relay.protocol === "https:" ? "wss:" : "ws:";
      }
      validateRelay(relay);
    } catch {
      throw refuse("The relay address must be a secure wss:// URL.");
    }
    // The relay gets only the lookup half of the code; the other half proves the computer.
    const keys = derivePairingCodeKeys(normalized);
    const response = await postToRelay(
      relay,
      "pairing/code/resolve",
      { code: keys.lookupCode },
      true,
    );
    if (lastPathSegment(relay) !== "relay") {
      relay.pathname = `${relay.pathname.replace(/\/$/, "")}/relay`;
    }
    const payload = { ...response, relay: relay.toString() };
    if (
      payload.v !== DJL_PAIRING_QR_VERSION ||
      !isIdentifier(payload.sessionId) ||
      !isIdentifier(payload.macDeviceId) ||
      !isIdentityKey(payload.macIdentityPublicKey) ||
      !Number.isInteger(payload.expiresAt)
    ) {
      throw refuse("The relay returned an unusable pairing.");
    }
    if (payload.expiresAt < now() - 60_000) throw refuse("The pairing code expired.");
    return {
      bootstrap: true,
      // Kept only for this handshake; never saved, never taken from the relay's answer.
      pairingSecret: Buffer.from(keys.pairingSecret, "base64"),
      relay: payload.relay,
      sessionId: payload.sessionId,
      macDeviceId: payload.macDeviceId,
      macIdentityPublicKey: payload.macIdentityPublicKey,
      displayName: typeof payload.displayName === "string" ? payload.displayName : "",
    };
  }

  async function resolveTrusted() {
    const { host, device } = state;
    const request = {
      macDeviceId: host.macDeviceId,
      phoneDeviceId: device.deviceId,
      phoneIdentityPublicKey: device.publicKey,
      nonce: randomUUID(),
      timestamp: now(),
    };
    request.signature = signBytes(
      device,
      buildTrustedSessionResolveTranscript({
        ...request,
        phoneIdentityPublicKey: Buffer.from(device.publicKey, "base64"),
      }),
    );
    const response = await postToRelay(new URL(host.relay), "trusted/session/resolve", request);
    if (
      response.macDeviceId !== host.macDeviceId ||
      response.macIdentityPublicKey !== host.macIdentityPublicKey
    ) {
      throw refuse("The relay offered a computer with a different identity.");
    }
    if (!isIdentifier(response.sessionId)) throw refuse("The relay returned an unusable session.");
    return {
      bootstrap: false,
      relay: host.relay,
      sessionId: response.sessionId,
      macDeviceId: host.macDeviceId,
      macIdentityPublicKey: host.macIdentityPublicKey,
      displayName:
        typeof response.displayName === "string" && response.displayName
          ? response.displayName
          : host.displayName,
    };
  }

  // Same candidates and error mapping as the phone's PairingRepository._resolve.
  async function postToRelay(relay, route, body, preservePath = false) {
    const candidates = resolveCandidates(relay, route, preservePath);
    for (let index = 0; index < candidates.length; index += 1) {
      const isLast = index === candidates.length - 1;
      let response;
      try {
        response = await fetchImpl(candidates[index], {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(RESOLVE_TIMEOUT_MS),
        });
      } catch {
        throw unreachable("The relay could not be reached.");
      }
      if (response.status === 408 || response.status === 429 || response.status >= 500) {
        throw unreachable("The relay is temporarily unavailable.");
      }
      let value;
      try {
        value = await response.json();
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
      } catch {
        if (response.status === 404 && !isLast) continue;
        throw unreachable("The relay returned an invalid response.");
      }
      if (OFFLINE_RESOLVE_CODES.has(value.code) && response.status !== 403) {
        throw unreachable("The computer is offline.");
      }
      if (response.status === 404 && !isLast) continue;
      if (response.status < 200 || response.status >= 300 || value.ok !== true) {
        throw refuse(
          typeof value.error === "string" ? value.error : "The relay refused the request.",
        );
      }
      return value;
    }
    throw refuse("The relay does not support this request.");
  }

  function openLink(target, gen) {
    if (target.bootstrap || cursor.sessionId !== target.sessionId) {
      cursor.seq = 0;
      cursor.epoch = null;
    }
    cursor.sessionId = target.sessionId;
    const ephemeral = generateKeyPairSync("x25519");
    const clientNonce = randomBytes(32).toString("base64");
    const url = `${target.relay.replace(/\/$/, "")}/${encodeURIComponent(target.sessionId)}`;
    // Signed like the phone's connect, so the relay can tell this client from a stranger.
    const connectSignature = signBytes(
      state.device,
      Buffer.from(
        buildRelayPhoneConnectTranscript({
          sessionId: target.sessionId,
          phoneDeviceId: state.device.deviceId,
          phoneIdentityPublicKey: Buffer.from(state.device.publicKey, "base64"),
        }),
      ),
    );
    const socket = new WebSocketImpl(url, {
      headers: {
        "x-role": "iphone",
        "x-phone-device-id": state.device.deviceId,
        "x-phone-identity-public-key": state.device.publicKey,
        "x-phone-signature": connectSignature,
      },
    });
    const current = {
      socket,
      target,
      gen,
      ephemeral,
      clientNonce,
      mode: target.bootstrap ? "qr_bootstrap" : "trusted_reconnect",
      hello: null,
      server: null,
      keys: null,
      keyEpoch: 0,
      ready: false,
      lastInboundCounter: -1,
      nextOutboundCounter: 0,
    };
    link = current;
    const isCurrent = () => link === current && gen === generation;

    afterDelay(HANDSHAKE_TIMEOUT_MS, () => {
      if (isCurrent() && !current.ready) dropLink(unreachable("The secure handshake timed out."));
    });
    const keepAlive = () => {
      if (!isCurrent() || socket.readyState !== WebSocketImpl.OPEN) return;
      socket.ping?.();
      afterDelay(PING_INTERVAL_MS, keepAlive);
    };

    socket.on("open", () => {
      if (!isCurrent()) return;
      current.hello = {
        kind: "clientHello",
        protocolVersion: DJL_SECURE_PROTOCOL_VERSION,
        sessionId: target.sessionId,
        handshakeMode: current.mode,
        phoneDeviceId: state.device.deviceId,
        phoneIdentityPublicKey: state.device.publicKey,
        phoneEphemeralPublicKey: rawPublicKey(ephemeral.publicKey),
        clientNonce,
      };
      socket.send(JSON.stringify(current.hello));
      afterDelay(PING_INTERVAL_MS, keepAlive);
    });
    socket.on("message", (data) => {
      if (!isCurrent()) return;
      let messages;
      try {
        messages = handleFrame(current, String(data));
      } catch (error) {
        dropLink(error instanceof LinkFailure ? error : unreachable("The secure channel failed."));
        return;
      }
      // Delivered outside the try: a throwing onMessage is the caller's bug, not a link failure.
      for (const message of messages) {
        onMessage(message);
        if (!isCurrent()) return;
      }
    });
    socket.on("error", () => {});
    socket.on("close", (closeCode) => {
      if (!isCurrent()) return;
      link = null;
      if (REFUSED_CLOSE_CODES.has(closeCode)) {
        fail(refuse(`The relay closed the link (${closeCode}).`));
      } else {
        fail(unreachable("The connection to the computer was lost."));
      }
    });
  }

  function handleFrame(current, text) {
    let frame;
    try {
      frame = JSON.parse(text);
    } catch {
      throw unreachable("The relay sent an invalid frame.");
    }
    if (!frame || typeof frame !== "object") throw unreachable("The relay sent an invalid frame.");
    if (frame.kind === "hostPresence") {
      if (frame.online === false) throw unreachable("The computer went offline.");
      return [];
    }
    if (frame.kind === "secureError") {
      throw REFUSED_SECURE_ERRORS.has(frame.code)
        ? refuse("The computer refused this link.")
        : unreachable("The secure channel failed.");
    }
    if (current.ready) {
      if (frame.kind !== "encryptedEnvelope") throw unreachable("Unencrypted frame rejected.");
      return receiveEnvelope(current, frame);
    }
    if (!current.server && frame.kind === "serverHello") receiveServerHello(current, frame);
    else if (current.server && frame.kind === "secureReady") receiveSecureReady(current, frame);
    // Anything else before the channel is ready (stale envelopes) cannot advance the handshake.
    return [];
  }

  function receiveServerHello(current, server) {
    const { target } = current;
    if (server.clientNonce != null && server.clientNonce !== current.clientNonce) return;
    if (
      server.protocolVersion !== DJL_SECURE_PROTOCOL_VERSION ||
      server.sessionId !== target.sessionId ||
      server.handshakeMode !== current.mode ||
      server.macDeviceId !== target.macDeviceId ||
      server.macIdentityPublicKey !== target.macIdentityPublicKey
    ) {
      throw refuse("The computer's identity does not match the paired one.");
    }
    const transcript = handshakeTranscript(current, server);
    if (!verifyBytes(target.macIdentityPublicKey, transcript, server.macSignature)) {
      if (server.clientNonce == null) return;
      throw refuse("The computer's handshake could not be verified.");
    }
    let phoneProof;
    if (target.bootstrap) {
      // The relay supplied the key that just verified. Only the secret from the typed code
      // proves this is the computer whose owner gave out the code.
      const expected = pairingProof(target.pairingSecret, transcript, DJL_PAIRING_PROOF_MAC_LABEL);
      if (typeof server.pairingProof !== "string" || !base64Equal(server.pairingProof, expected)) {
        throw refuse("The computer could not prove it made this pairing code.");
      }
      phoneProof = pairingProof(target.pairingSecret, transcript, DJL_PAIRING_PROOF_PHONE_LABEL);
    }
    current.server = server;
    current.transcript = transcript;
    if (server.bridgeReplayEpoch && server.bridgeReplayEpoch !== cursor.epoch) {
      cursor.seq = 0;
      cursor.epoch = server.bridgeReplayEpoch;
    }
    current.socket.send(
      JSON.stringify({
        kind: "clientAuth",
        sessionId: target.sessionId,
        phoneDeviceId: state.device.deviceId,
        keyEpoch: server.keyEpoch,
        phoneSignature: signBytes(
          state.device,
          Buffer.concat([transcript, lengthPrefixed(Buffer.from(DJL_CLIENT_AUTH_LABEL))]),
        ),
        ...(phoneProof ? { pairingProof: phoneProof } : {}),
      }),
    );
  }

  function receiveSecureReady(current, ready) {
    const { target, server } = current;
    if (
      ready.sessionId !== target.sessionId ||
      ready.keyEpoch !== server.keyEpoch ||
      ready.macDeviceId !== target.macDeviceId
    ) {
      return;
    }
    current.keys = deriveKeys(current, state.device.deviceId);
    current.keyEpoch = server.keyEpoch;
    // Trust only the authenticated identity, after secureReady and key agreement succeed.
    state = {
      ...state,
      host: {
        macDeviceId: target.macDeviceId,
        macIdentityPublicKey: target.macIdentityPublicKey,
        relay: target.relay,
        displayName: target.displayName,
        sessionId: target.sessionId,
      },
    };
    saveState(statePath, state);
    pendingCode = null;
    current.socket.send(
      JSON.stringify({
        kind: "resumeState",
        sessionId: target.sessionId,
        keyEpoch: server.keyEpoch,
        lastAppliedBridgeOutboundSeq: cursor.seq,
        ...(cursor.epoch ? { bridgeReplayEpoch: cursor.epoch } : {}),
      }),
    );
    current.ready = true;
    failures = 0;
    report("connected");
  }

  function receiveEnvelope(current, envelope) {
    const counter = envelope.counter;
    if (
      envelope.v !== DJL_SECURE_PROTOCOL_VERSION ||
      envelope.sessionId !== current.target.sessionId ||
      envelope.keyEpoch !== current.keyEpoch ||
      envelope.sender !== "mac" ||
      !Number.isSafeInteger(counter) ||
      counter <= current.lastInboundCounter
    ) {
      throw unreachable("The computer sent an invalid or replayed envelope.");
    }
    const payload = decryptEnvelope(envelope, current.keys.macToPhone, counter);
    if (!payload) throw unreachable("A message from the computer could not be authenticated.");
    current.lastInboundCounter = counter;
    const seq = Number.isInteger(payload.bridgeOutboundSeq) ? payload.bridgeOutboundSeq : null;
    if (seq != null && seq <= cursor.seq) return [];
    let decoded;
    try {
      decoded = JSON.parse(payload.payloadText);
    } catch {
      decoded = null;
    }
    // The host batches notifications into one frame as a JSON array.
    const messages = (Array.isArray(decoded) ? decoded : [decoded]).filter(
      (message) => message && typeof message === "object" && !Array.isArray(message),
    );
    for (const message of messages) {
      if (message.method === "djl/bufferedReplay/reset") {
        cursor.seq = Number(message.params?.resetBridgeOutboundSeqTo) || 0;
        cursor.epoch = message.params?.bridgeReplayEpoch ?? null;
      } else if (message.method === "djl/bufferedReplay/gap") {
        cursor.seq = Number(message.params?.lastDiscardedBridgeOutboundSeq) || cursor.seq;
      }
    }
    if (seq != null) cursor.seq = seq;
    return messages;
  }

  function dropLink(failure) {
    closeLink(1000);
    fail(failure);
  }

  function closeLink(closeCode) {
    const current = link;
    link = null;
    if (!current) return;
    try {
      current.socket.close(closeCode);
    } catch {
      current.socket.terminate?.();
    }
  }

  function fail(failure) {
    if (!running) return;
    if (failure.refused) {
      running = false;
      generation += 1;
      closeLink(1000);
      report("refused", failure.message);
      return;
    }
    report("offline", lastStatus === "offline" ? undefined : failure.message);
    const delay = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** failures);
    failures += 1;
    const gen = generation;
    afterDelay(delay, () => {
      if (running && gen === generation && !link) void attempt(gen);
    });
  }

  function afterDelay(ms, callback) {
    setTimer(callback, ms)?.unref?.();
  }

  return { start, send, stop, forget, hostName };
}

function handshakeTranscript(current, server) {
  const { target, hello } = current;
  return Buffer.from(
    buildHandshakeTranscript({
      sessionId: target.sessionId,
      protocolVersion: DJL_SECURE_PROTOCOL_VERSION,
      handshakeMode: current.mode,
      keyEpoch: server.keyEpoch,
      macDeviceId: target.macDeviceId,
      phoneDeviceId: hello.phoneDeviceId,
      macIdentityPublicKey: Buffer.from(target.macIdentityPublicKey, "base64"),
      phoneIdentityPublicKey: Buffer.from(hello.phoneIdentityPublicKey, "base64"),
      macEphemeralPublicKey: Buffer.from(String(server.macEphemeralPublicKey), "base64"),
      phoneEphemeralPublicKey: Buffer.from(hello.phoneEphemeralPublicKey, "base64"),
      clientNonce: Buffer.from(current.clientNonce, "base64"),
      serverNonce: Buffer.from(String(server.serverNonce), "base64"),
      expiresAtForTranscript: server.expiresAtForTranscript,
    }),
  );
}

function deriveKeys(current, phoneDeviceId) {
  const { target, server, transcript } = current;
  const sharedSecret = diffieHellman({
    privateKey: current.ephemeral.privateKey,
    publicKey: createPublicKey({
      key: { crv: "X25519", kty: "OKP", x: toBase64Url(server.macEphemeralPublicKey) },
      format: "jwk",
    }),
  });
  const salt = createHash("sha256").update(transcript).digest();
  const prefix = [
    DJL_SECURE_HANDSHAKE_TAG,
    target.sessionId,
    target.macDeviceId,
    phoneDeviceId,
    String(server.keyEpoch),
  ].join("|");
  const derive = (direction) =>
    Buffer.from(hkdfSync("sha256", sharedSecret, salt, Buffer.from(`${prefix}|${direction}`), 32));
  return { phoneToMac: derive("phoneToMac"), macToPhone: derive("macToPhone") };
}

function encryptEnvelope(payload, key, counter, sessionId, keyEpoch) {
  const cipher = createCipheriv("aes-256-gcm", key, Buffer.from(secureNonce("iphone", counter)));
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(JSON.stringify(payload), "utf8")),
    cipher.final(),
  ]);
  return {
    kind: "encryptedEnvelope",
    v: DJL_SECURE_PROTOCOL_VERSION,
    sessionId,
    keyEpoch,
    sender: "iphone",
    counter,
    ciphertext: ciphertext.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
}

function decryptEnvelope(envelope, key, counter) {
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(secureNonce("mac", counter)));
    decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, "base64")),
      decipher.final(),
    ]);
    const payload = JSON.parse(plaintext.toString("utf8"));
    return payload && typeof payload.payloadText === "string" ? payload : null;
  } catch {
    return null;
  }
}

function createDeviceIdentity() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    deviceId: randomUUID(),
    privateKey: fromBase64Url(privateKey.export({ format: "jwk" }).d),
    publicKey: rawPublicKey(publicKey),
  };
}

function signBytes(device, bytes) {
  const key = createPrivateKey({
    key: {
      crv: "Ed25519",
      kty: "OKP",
      d: toBase64Url(device.privateKey),
      x: toBase64Url(device.publicKey),
    },
    format: "jwk",
  });
  return sign(null, bytes, key).toString("base64");
}

function verifyBytes(publicKeyBase64, bytes, signatureBase64) {
  try {
    const key = createPublicKey({
      key: { crv: "Ed25519", kty: "OKP", x: toBase64Url(publicKeyBase64) },
      format: "jwk",
    });
    return verify(null, bytes, key, Buffer.from(String(signatureBase64), "base64"));
  } catch {
    return false;
  }
}

function rawPublicKey(keyObject) {
  return fromBase64Url(keyObject.export({ format: "jwk" }).x);
}

function pairingProof(secret, transcript, label) {
  return createHmac("sha256", secret)
    .update(buildPairingProofInput(transcript, label))
    .digest("base64");
}

function base64Equal(left, right) {
  const a = Buffer.from(String(left), "base64");
  const b = Buffer.from(String(right), "base64");
  return a.length === b.length && timingSafeEqual(a, b);
}

function lengthPrefixed(buffer) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(buffer.length, 0);
  return Buffer.concat([length, buffer]);
}

function toBase64Url(base64) {
  return Buffer.from(String(base64), "base64").toString("base64url");
}

function fromBase64Url(value) {
  return Buffer.from(value, "base64url").toString("base64");
}

function isIdentifier(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 256 &&
    !value.includes("/") &&
    !value.includes("..")
  );
}

function isIdentityKey(value) {
  return typeof value === "string" && Buffer.from(value, "base64").length === 32;
}

// Same rule as the phone's validateRelay(allowLocal: true): wss://, or ws:// on this machine only.
function validateRelay(url) {
  const local = LOCAL_RELAY_HOSTS.has(url.hostname);
  if (
    (url.protocol !== "wss:" && !(local && url.protocol === "ws:")) ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error("insecure relay");
  }
}

function lastPathSegment(url) {
  return url.pathname.split("/").findLast(Boolean);
}

// Mirrors resolveCandidates in pairing_repository.dart: relay path first (when kept), then the
// relay path without a trailing "relay" segment, then the origin root.
function resolveCandidates(relay, route, preservePath) {
  const base = new URL(relay.toString());
  base.protocol = base.protocol === "wss:" ? "https:" : base.protocol === "ws:" ? "http:" : "";
  base.search = "";
  base.hash = "";
  const segments = base.pathname.split("/").filter(Boolean);
  const trimmed = segments.at(-1) === "relay" ? segments.slice(0, -1) : segments;
  const paths = [
    ...(preservePath && segments.length > 0 ? [`/${[...segments, "v1", route].join("/")}`] : []),
    `/${[...trimmed, "v1", route].join("/")}`,
    `/v1/${route}`,
  ];
  return [...new Set(paths)].map((pathname) => new URL(pathname, base).toString());
}

function loadState(statePath) {
  let text;
  try {
    text = fs.readFileSync(statePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  const value = JSON.parse(text);
  const device = value?.device;
  if (
    value?.version !== 1 ||
    !isIdentifier(device?.deviceId) ||
    !isIdentityKey(device?.publicKey) ||
    !isIdentityKey(device?.privateKey)
  ) {
    throw new Error("unrecognized state file");
  }
  const host = value.host;
  if (host) {
    validateRelay(new URL(host.relay));
    if (!isIdentifier(host.macDeviceId) || !isIdentityKey(host.macIdentityPublicKey)) {
      throw new Error("unrecognized trusted host");
    }
  }
  return { version: 1, device, host: host || null };
}

function saveState(statePath, state) {
  fs.mkdirSync(path.dirname(statePath), { recursive: true, mode: 0o700 });
  fs.chmodSync(path.dirname(statePath), 0o700);
  const temporary = `${statePath}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, statePath);
}

module.exports = { createGuestLinkClient };
