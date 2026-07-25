// FILE: index.ts
// Purpose: Versioned wire contracts and byte-level compatibility helpers for DJL Remote.

import { Schema } from "effect";

export const DJL_PAIRING_QR_VERSION = 2 as const;
export const DJL_SECURE_PROTOCOL_VERSION = 2 as const;
export const DJL_SECURE_HANDSHAKE_TAG = "djl-e2ee-v1" as const;
export const DJL_CLIENT_AUTH_LABEL = "client-auth" as const;
export const DJL_TRUSTED_SESSION_RESOLVE_TAG = "djl-trusted-session-resolve-v1" as const;
export const DJL_PAIRING_TTL_MS = 5 * 60 * 1_000;
export const DJL_MAX_REPLAY_MESSAGES = 500;
export const DJL_MAX_REPLAY_BYTES = 10 * 1_024 * 1_024;

const BoundedIdentifier = Schema.String.check(Schema.isMinLength(1)).check(Schema.isMaxLength(256));
const BoundedMessage = Schema.String.check(Schema.isMinLength(1)).check(Schema.isMaxLength(2_000));
const Base64Key = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9+/]{43}=$/));
const Base64Value = Schema.String.check(Schema.isMinLength(1)).check(
  Schema.isMaxLength(16_000_000),
);
const NonNegativeInt = Schema.Int.check(
  Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
);
const PositiveTimestamp = Schema.Int.check(
  Schema.isBetween({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
);
const SecureRelayUrl = Schema.String.check(Schema.isPattern(/^wss:\/\//i)).check(
  Schema.isMaxLength(2_048),
);

export const HandshakeMode = Schema.Literals(["qr_bootstrap", "trusted_reconnect"]);
export type HandshakeMode = typeof HandshakeMode.Type;

export const SecureSender = Schema.Literals(["mac", "iphone"]);
export type SecureSender = typeof SecureSender.Type;

export const PairingQrPayload = Schema.Struct({
  v: Schema.Literal(DJL_PAIRING_QR_VERSION),
  relay: SecureRelayUrl,
  sessionId: BoundedIdentifier,
  macDeviceId: BoundedIdentifier,
  macIdentityPublicKey: Base64Key,
  expiresAt: PositiveTimestamp,
  displayName: Schema.optional(Schema.String.check(Schema.isMaxLength(160))),
});
export type PairingQrPayload = typeof PairingQrPayload.Type;

export const SecureClientHello = Schema.Struct({
  kind: Schema.Literal("clientHello"),
  protocolVersion: Schema.Literal(DJL_SECURE_PROTOCOL_VERSION),
  sessionId: BoundedIdentifier,
  handshakeMode: HandshakeMode,
  phoneDeviceId: BoundedIdentifier,
  phoneIdentityPublicKey: Base64Key,
  phoneEphemeralPublicKey: Base64Key,
  clientNonce: Base64Value,
});

export const SecureServerHello = Schema.Struct({
  kind: Schema.Literal("serverHello"),
  protocolVersion: Schema.Literal(DJL_SECURE_PROTOCOL_VERSION),
  sessionId: BoundedIdentifier,
  handshakeMode: HandshakeMode,
  macDeviceId: BoundedIdentifier,
  macIdentityPublicKey: Base64Key,
  macEphemeralPublicKey: Base64Key,
  serverNonce: Base64Value,
  keyEpoch: NonNegativeInt,
  bridgeReplayEpoch: Schema.optional(BoundedIdentifier),
  expiresAtForTranscript: NonNegativeInt,
  macSignature: Base64Value,
  clientNonce: Schema.optional(Base64Value),
  displayName: Schema.optional(Schema.String.check(Schema.isMaxLength(160))),
});

export const SecureClientAuth = Schema.Struct({
  kind: Schema.Literal("clientAuth"),
  sessionId: BoundedIdentifier,
  phoneDeviceId: BoundedIdentifier,
  keyEpoch: NonNegativeInt,
  phoneSignature: Base64Value,
});

export const SecureReady = Schema.Struct({
  kind: Schema.Literal("secureReady"),
  sessionId: BoundedIdentifier,
  keyEpoch: NonNegativeInt,
  macDeviceId: BoundedIdentifier,
});

export const SecureResumeState = Schema.Struct({
  kind: Schema.Literal("resumeState"),
  sessionId: BoundedIdentifier,
  keyEpoch: NonNegativeInt,
  lastAppliedBridgeOutboundSeq: NonNegativeInt,
  bridgeReplayEpoch: Schema.optional(BoundedIdentifier),
});

export const SecureEnvelope = Schema.Struct({
  kind: Schema.Literal("encryptedEnvelope"),
  v: Schema.Literal(DJL_SECURE_PROTOCOL_VERSION),
  sessionId: BoundedIdentifier,
  keyEpoch: NonNegativeInt,
  sender: SecureSender,
  counter: NonNegativeInt,
  ciphertext: Base64Value,
  tag: Base64Value,
});

export const SecureError = Schema.Struct({
  kind: Schema.Literal("secureError"),
  code: BoundedIdentifier,
  message: BoundedMessage,
});

export const SecureControlMessage = Schema.Union([
  SecureClientHello,
  SecureServerHello,
  SecureClientAuth,
  SecureReady,
  SecureResumeState,
  SecureEnvelope,
  SecureError,
]);
export type SecureControlMessage = typeof SecureControlMessage.Type;

export interface HandshakeTranscriptInput {
  readonly sessionId: string;
  readonly protocolVersion: number;
  readonly handshakeMode: HandshakeMode;
  readonly keyEpoch: number;
  readonly macDeviceId: string;
  readonly phoneDeviceId: string;
  readonly macIdentityPublicKey: Uint8Array;
  readonly phoneIdentityPublicKey: Uint8Array;
  readonly macEphemeralPublicKey: Uint8Array;
  readonly phoneEphemeralPublicKey: Uint8Array;
  readonly clientNonce: Uint8Array;
  readonly serverNonce: Uint8Array;
  readonly expiresAtForTranscript: number;
}

const textEncoder = new TextEncoder();

const lengthPrefixed = (value: Uint8Array): Uint8Array => {
  if (value.byteLength > 0xffff_ffff) {
    throw new RangeError("Remote protocol field exceeds the 32-bit transcript limit");
  }
  const result = new Uint8Array(4 + value.byteLength);
  new DataView(result.buffer).setUint32(0, value.byteLength, false);
  result.set(value, 4);
  return result;
};

const lengthPrefixedUtf8 = (value: string | number): Uint8Array =>
  lengthPrefixed(textEncoder.encode(String(value)));

const concatenate = (parts: ReadonlyArray<Uint8Array>): Uint8Array => {
  const length = parts.reduce((total, part) => total + part.byteLength, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
};

export const buildHandshakeTranscript = (input: HandshakeTranscriptInput): Uint8Array =>
  concatenate([
    lengthPrefixedUtf8(DJL_SECURE_HANDSHAKE_TAG),
    lengthPrefixedUtf8(input.sessionId),
    lengthPrefixedUtf8(input.protocolVersion),
    lengthPrefixedUtf8(input.handshakeMode),
    lengthPrefixedUtf8(input.keyEpoch),
    lengthPrefixedUtf8(input.macDeviceId),
    lengthPrefixedUtf8(input.phoneDeviceId),
    lengthPrefixed(input.macIdentityPublicKey),
    lengthPrefixed(input.phoneIdentityPublicKey),
    lengthPrefixed(input.macEphemeralPublicKey),
    lengthPrefixed(input.phoneEphemeralPublicKey),
    lengthPrefixed(input.clientNonce),
    lengthPrefixed(input.serverNonce),
    lengthPrefixedUtf8(input.expiresAtForTranscript),
  ]);

export interface TrustedSessionResolveTranscriptInput {
  readonly macDeviceId: string;
  readonly phoneDeviceId: string;
  readonly phoneIdentityPublicKey: Uint8Array;
  readonly nonce: string;
  readonly timestamp: number;
}

export const buildTrustedSessionResolveTranscript = (
  input: TrustedSessionResolveTranscriptInput,
): Uint8Array =>
  concatenate([
    lengthPrefixedUtf8(DJL_TRUSTED_SESSION_RESOLVE_TAG),
    lengthPrefixedUtf8(input.macDeviceId),
    lengthPrefixedUtf8(input.phoneDeviceId),
    lengthPrefixed(input.phoneIdentityPublicKey),
    lengthPrefixedUtf8(input.nonce),
    lengthPrefixedUtf8(input.timestamp),
  ]);

export const secureNonce = (sender: SecureSender, counter: number): Uint8Array => {
  if (!Number.isSafeInteger(counter) || counter < 0) {
    throw new RangeError("Secure envelope counter must be a non-negative safe integer");
  }

  const nonce = new Uint8Array(12);
  nonce[0] = sender === "mac" ? 1 : 2;
  let remaining = BigInt(counter);
  for (let index = 11; index >= 1; index -= 1) {
    nonce[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return nonce;
};
