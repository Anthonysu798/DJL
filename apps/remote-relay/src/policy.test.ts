import { describe, expect, it } from "vitest";

import {
  classifyPhone,
  constantTimeEqual,
  consumeMessageBudget,
  MAX_JSON_BODY_BYTES,
  type MessageBudgetState,
  normalizePairingCode,
  parseJsonFrame,
  parseRelayRoute,
  phoneRecipients,
  readBoundedJson,
  readRelayRole,
  reclassifyPhone,
  type RelayRegistration,
  replacesPhone,
  resolvePinnedIdentityKey,
  resolveRegistrationUpdate,
  resolveRelayRegistration,
  validateRegistration,
} from "./policy";

const key = (fill: number): string => btoa(String.fromCharCode(...new Uint8Array(32).fill(fill)));
const pairingNow = 1_784_376_000_000;
const stored: RelayRegistration = {
  sessionId: "trusted_session_1234567890",
  macDeviceId: "mac-device-1",
  macIdentityPublicKey: key(1),
  displayName: "Toni’s Mac",
  trustedPhoneDeviceId: "phone-1",
  trustedPhonePublicKey: key(2),
  pairingCode: "ABCDEF2345",
  pairingVersion: 2,
  pairingExpiresAt: pairingNow + 300_000,
};
const post = (init: object): Request =>
  new Request("https://relay.djl.app/v1/pairing/code/resolve", {
    method: "POST",
    ...init,
  } as RequestInit);
const trustedPhone = { deviceId: "phone-1", publicKey: key(2) };
const newPhone = { deviceId: "phone-2", publicKey: key(3) };

describe("remote relay policy", () => {
  it("accepts only bounded, opaque session routes", () => {
    expect(parseRelayRoute(new URL("https://relay.djl.app/relay/session_1234567890"))).toEqual({
      sessionId: "session_1234567890",
    });
    expect(parseRelayRoute(new URL("https://relay.djl.app/session_1234567890"))).toEqual({
      sessionId: "session_1234567890",
    });
    expect(parseRelayRoute(new URL("https://relay.djl.app/relay/../../admin"))).toBeNull();
    expect(parseRelayRoute(new URL("https://relay.djl.app/relay/short"))).toBeNull();
  });

  it("allows exactly one host role and the compatible phone aliases", () => {
    expect(
      readRelayRole(new Request("https://relay.djl.app", { headers: { "x-role": "mac" } })),
    ).toBe("mac");
    expect(readRelayRole(new Request("https://relay.djl.app?role=iphone"))).toBe("iphone");
    expect(readRelayRole(new Request("https://relay.djl.app?role=mobile"))).toBe("iphone");
    expect(readRelayRole(new Request("https://relay.djl.app?role=admin"))).toBeNull();
  });

  it("normalizes pairing codes without accepting ambiguous characters", () => {
    expect(normalizePairingCode("ABCD-EF23-45")).toBe("ABCDEF2345");
    expect(normalizePairingCode("ABCD0F2345")).toBeNull();
    expect(normalizePairingCode("tiny")).toBeNull();
  });

  it("bounds registration metadata and enforces expiry", () => {
    const registration = validateRegistration(
      {
        macDeviceId: "mac-device-1",
        macIdentityPublicKey: btoa(String.fromCharCode(...new Uint8Array(32).fill(1))),
        displayName: "Toni’s Mac",
        trustedPhoneDeviceId: "phone-1",
        trustedPhonePublicKey: btoa(String.fromCharCode(...new Uint8Array(32).fill(2))),
        pairingCode: "ABCDEF2345",
        pairingVersion: 2,
        pairingExpiresAt: 1_784_376_300_000,
      },
      1_784_376_000_000,
    );

    expect(registration?.pairingCode).toBe("ABCDEF2345");
    expect(validateRegistration({ ...registration, displayName: "x".repeat(161) }, 1)).toBeNull();
    expect(
      validateRegistration(
        { ...registration, pairingExpiresAt: 1_784_375_999_999 },
        1_784_376_000_000,
      ),
    ).toBeNull();
  });

  it("keeps a trusted registration usable after the short pairing window expires", () => {
    const sessionId = "trusted_session_1234567890";
    const pairingNow = 1_784_376_000_000;
    const input = {
      macDeviceId: "mac-device-1",
      macIdentityPublicKey: btoa(String.fromCharCode(...new Uint8Array(32).fill(1))),
      displayName: "Toni’s Mac",
      trustedPhoneDeviceId: "phone-1",
      trustedPhonePublicKey: btoa(String.fromCharCode(...new Uint8Array(32).fill(2))),
      pairingCode: "ABCDEF2345",
      pairingVersion: 2,
      pairingExpiresAt: pairingNow + 300_000,
    };
    const trusted = validateRegistration(input, pairingNow, sessionId);
    expect(trusted).not.toBeNull();

    const reconnectNow = input.pairingExpiresAt + 1;
    expect(resolveRelayRegistration(input, trusted ?? undefined, reconnectNow, sessionId)).toEqual(
      trusted,
    );
    expect(resolveRelayRegistration(input, undefined, reconnectNow, sessionId)).toBeNull();
    expect(
      resolveRelayRegistration(
        input,
        trusted ?? undefined,
        reconnectNow,
        "different_session_1234567890",
      ),
    ).toBeNull();
  });

  it("closes a message budget at the first over-limit frame", () => {
    const first = consumeMessageBudget(undefined, 1_000, 3);
    const second = consumeMessageBudget(first.state, 1_001, 3);
    const third = consumeMessageBudget(second.state, 1_002, 3);
    const fourth = consumeMessageBudget(third.state, 1_003, 3);

    expect(first.allowed).toBe(true);
    expect(third.allowed).toBe(true);
    expect(fourth.allowed).toBe(false);
    expect(consumeMessageBudget(fourth.state, 11_001, 3).allowed).toBe(true);
  });

  it("allows 600 frames per ten-second window by default", () => {
    let state: MessageBudgetState | undefined;
    for (let index = 0; index < 600; index += 1) {
      const result = consumeMessageBudget(state, 1_000 + index);
      expect(result.allowed).toBe(true);
      state = result.state;
    }
    expect(consumeMessageBudget(state, 1_601).allowed).toBe(false);
  });

  it("lets an in-band update restate only the identity registered at connect time", () => {
    const { sessionId: _sessionId, ...frame } = stored;

    expect(resolveRegistrationUpdate(frame, stored, pairingNow)).toEqual(stored);
    expect(
      resolveRegistrationUpdate({ ...frame, macDeviceId: "other-mac" }, stored, pairingNow),
    ).toBeNull();
    expect(
      resolveRegistrationUpdate({ ...frame, macIdentityPublicKey: key(9) }, stored, pairingNow),
    ).toBeNull();
    expect(resolveRegistrationUpdate(frame, undefined, pairingNow)).toBeNull();
    expect(resolveRegistrationUpdate("not-an-object", stored, pairingNow)).toBeNull();
  });

  it("still moves the trusted phone after the pairing window expired", () => {
    const { sessionId: _sessionId, ...frame } = stored;
    const expired = stored.pairingExpiresAt + 1;

    expect(
      resolveRegistrationUpdate(
        {
          ...frame,
          trustedPhoneDeviceId: newPhone.deviceId,
          trustedPhonePublicKey: newPhone.publicKey,
          pairingCode: "ZZZZZZ2345",
        },
        stored,
        expired,
      ),
    ).toEqual({
      ...stored,
      trustedPhoneDeviceId: newPhone.deviceId,
      trustedPhonePublicKey: newPhone.publicKey,
    });
    expect(
      resolveRegistrationUpdate({ ...frame, trustedPhonePublicKey: "not-a-key" }, stored, expired),
    ).toBeNull();
  });

  it("pins the first signed identity key and refuses anything else afterwards", () => {
    expect(resolvePinnedIdentityKey(undefined, key(1), false)).toBeNull();
    expect(resolvePinnedIdentityKey(undefined, key(1), true)).toBe(key(1));
    expect(resolvePinnedIdentityKey(key(1), key(1), true)).toBe(key(1));
    expect(resolvePinnedIdentityKey(key(1), key(1), false)).toBe(false);
    expect(resolvePinnedIdentityKey(key(1), key(9), true)).toBe(false);
  });

  it("classifies a phone by the identity it proved", () => {
    expect(classifyPhone(undefined, stored)).toBe("anonymous");
    expect(classifyPhone(trustedPhone, stored)).toBe("trusted");
    expect(classifyPhone(newPhone, stored)).toBe("candidate");
    expect(classifyPhone({ ...trustedPhone, publicKey: key(9) }, stored)).toBe("candidate");
    expect(classifyPhone(trustedPhone, undefined)).toBe("candidate");
    expect(
      classifyPhone(trustedPhone, {
        ...stored,
        trustedPhoneDeviceId: null,
        trustedPhonePublicKey: null,
      }),
    ).toBe("candidate");
  });

  it("promotes the newly paired candidate and drops the phone it replaced", () => {
    const repaired = {
      ...stored,
      trustedPhoneDeviceId: newPhone.deviceId,
      trustedPhonePublicKey: newPhone.publicKey,
    };

    expect(reclassifyPhone("candidate", newPhone, repaired)).toBe("trusted");
    expect(reclassifyPhone("trusted", trustedPhone, repaired)).toBeNull();
    expect(reclassifyPhone("trusted", trustedPhone, stored)).toBe("trusted");
    expect(reclassifyPhone("candidate", newPhone, stored)).toBe("candidate");
    expect(reclassifyPhone("anonymous", undefined, repaired)).toBe("anonymous");
    expect(reclassifyPhone(undefined, undefined, repaired)).toBe("anonymous");
  });

  it("lets only a trusted newcomer disconnect the trusted phone", () => {
    expect(replacesPhone("trusted", "trusted")).toBe(true);
    expect(replacesPhone("candidate", "trusted")).toBe(false);
    expect(replacesPhone("anonymous", "trusted")).toBe(false);
    expect(replacesPhone("candidate", "anonymous")).toBe(true);
    expect(replacesPhone("anonymous", "candidate")).toBe(true);
    expect(replacesPhone("anonymous", undefined)).toBe(true);
  });

  it("sends ciphertext to the trusted phone only and handshake frames to every phone", () => {
    const trusted = { id: "trusted", phoneClass: "trusted" } as const;
    const secondary = { id: "secondary", phoneClass: "candidate" } as const;
    const legacy = { id: "legacy", phoneClass: undefined };

    for (const kind of ["serverHello", "secureReady", "secureError"]) {
      expect(phoneRecipients([trusted, secondary, legacy], kind)).toEqual([
        trusted,
        secondary,
        legacy,
      ]);
    }
    expect(phoneRecipients([trusted, secondary, legacy], "encryptedEnvelope")).toEqual([trusted]);
    expect(phoneRecipients([trusted, secondary], undefined)).toEqual([trusted]);
    // Without a trusted phone connected the relay forwards as it always has.
    expect(phoneRecipients([secondary, legacy], "encryptedEnvelope")).toEqual([secondary, legacy]);
  });

  it("reads a frame kind only from JSON text frames", () => {
    expect(parseJsonFrame('{"kind":"secureReady"}')).toEqual({ kind: "secureReady" });
    expect(parseJsonFrame("opaque")).toBeNull();
    expect(parseJsonFrame("null")).toBeNull();
    expect(parseJsonFrame(new ArrayBuffer(4))).toBeNull();
  });

  it("stops reading a chunked body at the cap even without a content-length", async () => {
    let pulls = 0;
    let cancelled = false;
    const chunk = new Uint8Array(1_024).fill(0x20);
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        controller.enqueue(chunk);
      },
      cancel() {
        cancelled = true;
      },
    });
    const request = new Request("https://relay.djl.app/v1/pairing/code/resolve", {
      method: "POST",
      body: endless,
      duplex: "half",
    } as RequestInit);

    expect(request.headers.get("content-length")).toBeNull();
    expect(await readBoundedJson(request)).toBeNull();
    expect(cancelled).toBe(true);
    expect(pulls).toBeLessThanOrEqual(MAX_JSON_BODY_BYTES / chunk.byteLength + 2);
  });

  it("parses a small chunked body and rejects a declared oversize one unread", async () => {
    const encoder = new TextEncoder();
    const chunked = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('{"code":'));
        controller.enqueue(encoder.encode('"ABCDEF2345"}'));
        controller.close();
      },
    });

    expect(await readBoundedJson(post({ body: chunked, duplex: "half" }))).toEqual({
      code: "ABCDEF2345",
    });
    expect(await readBoundedJson(post({ body: "[1]" }))).toBeNull();
    expect(await readBoundedJson(post({}))).toBeNull();
    expect(
      await readBoundedJson(
        post({ body: "{}", headers: { "content-length": String(MAX_JSON_BODY_BYTES + 1) } }),
      ),
    ).toBeNull();
    expect(
      await readBoundedJson(
        post({ body: JSON.stringify({ pad: "x".repeat(MAX_JSON_BODY_BYTES) }) }),
      ),
    ).toBeNull();
  });

  it("compares secrets without short-circuiting on length or content", async () => {
    expect(await constantTimeEqual("Bearer admin-token", "Bearer admin-token")).toBe(true);
    expect(await constantTimeEqual("Bearer admin-token", "Bearer admin-tokeN")).toBe(false);
    expect(await constantTimeEqual("", "Bearer admin-token")).toBe(false);
  });
});
