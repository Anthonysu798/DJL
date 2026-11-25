import {
  buildRelayMacRegistrationTranscript,
  buildRelayPhoneConnectTranscript,
} from "@djl/remote-protocol";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The Durable Object base class only exists inside workerd; these tests drive the two objects
// against an in-memory stand-in. vps/relay.test.mjs repeats the connect paths on the real runtime.
vi.mock("cloudflare:workers", () => ({
  DurableObject: class {
    constructor(
      readonly ctx: unknown,
      readonly env: unknown,
    ) {}
  },
}));

import { DJLRelayRegistry, DJLRelaySession } from "./index";
import type { PhoneClass, PhoneIdentity, RelayRegistration } from "./policy";

const SESSION_ID = "relay_session_1234567890";
const toBase64 = (bytes: ArrayBuffer | Uint8Array): string =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)));
const key = (fill: number): string => toBase64(new Uint8Array(32).fill(fill));

const createIdentity = async (): Promise<{
  publicKey: string;
  sign: (transcript: (publicKey: Uint8Array) => Uint8Array) => Promise<string>;
}> => {
  const pair = (await crypto.subtle.generateKey("Ed25519", true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  return {
    publicKey: toBase64(raw),
    sign: async (transcript) =>
      toBase64(
        await crypto.subtle.sign("Ed25519", pair.privateKey, new Uint8Array(transcript(raw))),
      ),
  };
};

const createStorage = () => {
  const rows = new Map<string, unknown>();
  return {
    rows,
    get: async (name: string) => structuredClone(rows.get(name)),
    put: async (entry: string | Record<string, unknown>, value?: unknown) => {
      const entries = typeof entry === "string" ? { [entry]: value } : entry;
      for (const [name, row] of Object.entries(entries)) rows.set(name, structuredClone(row));
    },
    delete: async (name: string) => rows.delete(name),
  };
};

class FakeSocket {
  readyState: number = WebSocket.OPEN;
  readonly sent: Array<string | ArrayBuffer> = [];
  closeCode: number | null = null;
  constructor(public attachment: Record<string, unknown>) {}
  deserializeAttachment(): unknown {
    return this.attachment;
  }
  serializeAttachment(value: Record<string, unknown>): void {
    this.attachment = structuredClone(value);
  }
  send(message: string | ArrayBuffer): void {
    this.sent.push(message);
  }
  close(code: number): void {
    this.closeCode = code;
    this.readyState = WebSocket.CLOSED;
  }
}

const createRelay = () => {
  const registryStorage = createStorage();
  const registry = new DJLRelayRegistry({ storage: registryStorage } as never, {} as never);
  const sessionStorage = createStorage();
  const sockets: FakeSocket[] = [];
  const session = new DJLRelaySession(
    {
      storage: sessionStorage,
      getWebSockets: (tag?: string) =>
        sockets.filter((socket) => !tag || tag === `role:${String(socket.attachment.role)}`),
    } as never,
    {
      REGISTRY: {
        getByName: () => ({
          fetch: (url: string, init: RequestInit) => registry.fetch(new Request(url, init)),
        }),
      },
    } as never,
  );
  const addSocket = (attachment: Record<string, unknown>): FakeSocket => {
    const socket = new FakeSocket({ connectionId: "c", connectedAt: 0, ...attachment });
    sockets.push(socket);
    return socket;
  };
  return {
    registry,
    registryRows: registryStorage.rows,
    session,
    sessionRows: sessionStorage.rows,
    register: (body: unknown) =>
      registry.fetch(
        new Request("https://registry/internal/register", {
          method: "POST",
          body: JSON.stringify(body),
        }),
      ),
    resolveCode: async (code: string) => {
      const response = await registry.fetch(
        new Request("https://registry/v1/pairing/code/resolve", {
          method: "POST",
          body: JSON.stringify({ code }),
        }),
      );
      return (await response.json()) as { sessionId?: string; code?: string };
    },
    connect: (role: string, headers: Record<string, string>) =>
      session.fetch(
        new Request(`https://relay.invalid/relay/${SESSION_ID}?role=${role}`, {
          headers: { upgrade: "websocket", ...headers },
        }),
      ),
    addMac: (signed = false) => addSocket({ role: "mac", signed }),
    addPhone: (phoneClass?: PhoneClass, phoneIdentity?: PhoneIdentity) =>
      addSocket({ role: "iphone", phoneClass, phoneIdentity }),
    send: (socket: FakeSocket, message: string) =>
      session.webSocketMessage(socket as never, message),
  };
};

const makeRegistration = (overrides: Partial<RelayRegistration> = {}): RelayRegistration => ({
  sessionId: SESSION_ID,
  macDeviceId: "mac-device-1",
  macIdentityPublicKey: key(1),
  displayName: "QA Mac",
  trustedPhoneDeviceId: null,
  trustedPhonePublicKey: null,
  pairingCode: "ABCDEF2345",
  pairingVersion: 2,
  pairingExpiresAt: Date.now() + 120_000,
  ...overrides,
});

const errorCode = async (response: Response): Promise<string> =>
  ((await response.json()) as { code: string }).code;

const registrationFrame = (registration: unknown): string =>
  JSON.stringify({ kind: "relayMacRegistration", registration });

describe("relay registry", () => {
  it("accepts unsigned registrations from older computers without pinning a key", async () => {
    const relay = createRelay();

    expect((await relay.register(makeRegistration())).status).toBe(200);
    expect((await relay.register(makeRegistration({ macIdentityPublicKey: key(9) }))).status).toBe(
      200,
    );
    expect(relay.registryRows.get("mac:mac-device-1")).toMatchObject({
      registration: { macIdentityPublicKey: key(9) },
    });
    expect(relay.registryRows.get("mac:mac-device-1")).not.toHaveProperty("pinnedIdentityKey");
  });

  it("pins a signed identity key and then refuses unsigned or re-keyed registrations", async () => {
    const relay = createRelay();
    expect((await relay.register({ ...makeRegistration(), signed: true })).status).toBe(200);
    const pinned = structuredClone(relay.registryRows.get("mac:mac-device-1"));
    expect(pinned).toMatchObject({ pinnedIdentityKey: key(1) });

    const hijack = makeRegistration({
      sessionId: "attacker_session_1234567890",
      pairingCode: "ZZZZZZ2345",
    });
    for (const body of [
      hijack,
      { ...hijack, signed: true, macIdentityPublicKey: key(9) },
      { ...hijack, signed: "true" },
    ]) {
      const response = await relay.register(body);
      expect(response.status).toBe(403);
      expect(await errorCode(response)).toBe("mac_identity_mismatch");
    }
    // Nothing was overwritten and the owner's pairing code still resolves to the owner.
    expect(relay.registryRows.get("mac:mac-device-1")).toEqual(pinned);
    expect(relay.registryRows.has("code:ZZZZZZ2345")).toBe(false);
    expect(await relay.resolveCode("ABCDEF2345")).toMatchObject({ sessionId: SESSION_ID });

    expect((await relay.register({ ...makeRegistration(), signed: true })).status).toBe(200);
  });

  it("deletes or replaces a pairing-code row only for the computer that owns it", async () => {
    const relay = createRelay();
    await relay.register(makeRegistration());
    const other = makeRegistration({
      sessionId: "other_session_1234567890",
      macDeviceId: "mac-device-2",
    });

    // A second computer claiming the same code does not take the row over...
    expect((await relay.register(other)).status).toBe(200);
    expect(await relay.resolveCode("ABCDEF2345")).toMatchObject({ sessionId: SESSION_ID });
    // ...and moving on to another code does not delete a row it never owned.
    expect((await relay.register({ ...other, pairingCode: "ZZZZZZ2345" })).status).toBe(200);
    expect(await relay.resolveCode("ABCDEF2345")).toMatchObject({ sessionId: SESSION_ID });
    expect(await relay.resolveCode("ZZZZZZ2345")).toMatchObject({
      sessionId: "other_session_1234567890",
    });

    // The owner still rotates its own code.
    await relay.register(makeRegistration({ pairingCode: "YYYYYY2345" }));
    expect(relay.registryRows.has("code:ABCDEF2345")).toBe(false);
    expect(await relay.resolveCode("YYYYYY2345")).toMatchObject({ sessionId: SESSION_ID });
  });

  it("refuses an oversized registry body sent without a content-length", async () => {
    const relay = createRelay();
    const chunk = new TextEncoder().encode(" ".repeat(4_096));
    let sent = 0;
    const response = await relay.registry.fetch(
      new Request("https://registry/v1/pairing/code/resolve", {
        method: "POST",
        body: new ReadableStream<Uint8Array>({
          pull(controller) {
            sent += 1;
            controller.enqueue(chunk);
          },
        }),
        duplex: "half",
      } as RequestInit),
    );

    expect(response.status).toBe(400);
    expect(sent).toBeLessThan(10);
  });
});

describe("relay session", () => {
  let relay: ReturnType<typeof createRelay>;
  const trustedPhone = { deviceId: "phone-1", publicKey: key(2) };
  const newPhone = { deviceId: "phone-2", publicKey: key(3) };
  const stored = makeRegistration({
    trustedPhoneDeviceId: trustedPhone.deviceId,
    trustedPhonePublicKey: trustedPhone.publicKey,
  });
  const { sessionId: _sessionId, ...frameRegistration } = stored;
  const envelope = JSON.stringify({ kind: "encryptedEnvelope", ciphertext: "opaque" });

  beforeEach(async () => {
    relay = createRelay();
    relay.sessionRows.set("registration", stored);
    await relay.register(stored);
  });

  it("never forwards an in-band registration frame to a phone, valid or not", async () => {
    const mac = relay.addMac();
    const phone = relay.addPhone();
    const frames = [
      registrationFrame(frameRegistration),
      registrationFrame({ ...frameRegistration, pairingExpiresAt: Date.now() - 1 }),
      registrationFrame({ ...frameRegistration, macDeviceId: "other-mac" }),
      registrationFrame({ ...frameRegistration, trustedPhonePublicKey: "" }),
      registrationFrame("garbage"),
      JSON.stringify({ kind: "relayMacRegistration" }),
    ];

    for (const frame of frames) await relay.send(mac, frame);

    expect(phone.sent).toEqual([]);
  });

  it("ignores an in-band frame that names another computer or identity key", async () => {
    const mac = relay.addMac();

    await relay.send(
      mac,
      registrationFrame({
        ...frameRegistration,
        macDeviceId: "victim-mac",
        trustedPhoneDeviceId: newPhone.deviceId,
        trustedPhonePublicKey: newPhone.publicKey,
      }),
    );
    await relay.send(
      mac,
      registrationFrame({
        ...frameRegistration,
        macIdentityPublicKey: key(9),
        trustedPhoneDeviceId: newPhone.deviceId,
        trustedPhonePublicKey: newPhone.publicKey,
      }),
    );

    expect(relay.sessionRows.get("registration")).toEqual(stored);
    expect(relay.registryRows.has("mac:victim-mac")).toBe(false);
    expect(relay.registryRows.get("mac:mac-device-1")).toMatchObject({ registration: stored });
  });

  it("applies the trusted phone from an in-band frame whose pairing window expired", async () => {
    const mac = relay.addMac();
    const updated = {
      ...stored,
      trustedPhoneDeviceId: newPhone.deviceId,
      trustedPhonePublicKey: newPhone.publicKey,
    };

    await relay.send(
      mac,
      registrationFrame({
        ...frameRegistration,
        trustedPhoneDeviceId: newPhone.deviceId,
        trustedPhonePublicKey: newPhone.publicKey,
        pairingExpiresAt: Date.now() - 1,
      }),
    );

    expect(relay.sessionRows.get("registration")).toEqual(updated);
    expect(relay.registryRows.get("mac:mac-device-1")).toMatchObject({ registration: updated });
  });

  it("carries the connection's signature status into in-band updates of a pinned computer", async () => {
    await relay.register({ ...stored, signed: true });
    const frame = registrationFrame({ ...frameRegistration, displayName: "Renamed Mac" });

    await relay.send(relay.addMac(false), frame);
    expect(relay.sessionRows.get("registration")).toEqual(stored);

    await relay.send(relay.addMac(true), frame);
    expect(relay.sessionRows.get("registration")).toMatchObject({ displayName: "Renamed Mac" });
  });

  it("gives a secondary phone handshake frames only while the trusted phone is connected", async () => {
    const mac = relay.addMac();
    const trusted = relay.addPhone("trusted", trustedPhone);
    const candidate = relay.addPhone("candidate", newPhone);
    const anonymous = relay.addPhone("anonymous");
    const handshake = ["serverHello", "secureReady", "secureError"].map((kind) =>
      JSON.stringify({ kind }),
    );

    for (const frame of [...handshake, envelope, "opaque-host-frame"]) await relay.send(mac, frame);

    expect(trusted.sent).toEqual([...handshake, envelope, "opaque-host-frame"]);
    expect(candidate.sent).toEqual(handshake);
    expect(anonymous.sent).toEqual(handshake);

    // Secondary to computer is forwarded as before.
    await relay.send(candidate, "client-hello");
    expect(mac.sent).toEqual(["client-hello"]);
  });

  it("forwards everything to every phone when no trusted phone is connected", async () => {
    const mac = relay.addMac();
    const candidate = relay.addPhone("candidate", newPhone);
    const legacy = relay.addPhone();
    const closedTrusted = relay.addPhone("trusted", trustedPhone);
    closedTrusted.close(4001);

    await relay.send(mac, envelope);

    expect(candidate.sent).toEqual([envelope]);
    expect(legacy.sent).toEqual([envelope]);
    expect(closedTrusted.sent).toEqual([]);
  });

  it("promotes the candidate the computer names and closes the phone it replaced", async () => {
    const mac = relay.addMac();
    const trusted = relay.addPhone("trusted", trustedPhone);
    const candidate = relay.addPhone("candidate", newPhone);
    const bystander = relay.addPhone("anonymous");

    await relay.send(
      mac,
      registrationFrame({
        ...frameRegistration,
        trustedPhoneDeviceId: newPhone.deviceId,
        trustedPhonePublicKey: newPhone.publicKey,
      }),
    );
    await relay.send(mac, envelope);

    expect(trusted.closeCode).toBe(4001);
    expect(candidate.attachment.phoneClass).toBe("trusted");
    expect(candidate.closeCode).toBeNull();
    expect(bystander.closeCode).toBeNull();
    expect(candidate.sent).toEqual([envelope]);
    expect(trusted.sent).toEqual([]);
    expect(bystander.sent).toEqual([]);
  });

  it("rejects a computer whose registration signature does not verify", async () => {
    const identity = await createIdentity();
    const headers = {
      "x-djl-session-secret": "s".repeat(48),
      "x-djl-notification-secret": "n".repeat(48),
      "x-mac-device-id": "mac-device-9",
      "x-mac-identity-public-key": identity.publicKey,
      "x-machine-name": "QA Mac",
      "x-pairing-code": "XXXXXX2345",
      "x-pairing-version": "2",
      "x-pairing-expires-at": String(Date.now() + 120_000),
    };
    const signature = await identity.sign((macIdentityPublicKey) =>
      buildRelayMacRegistrationTranscript({
        sessionId: "another_session_1234567890",
        macDeviceId: "mac-device-9",
        macIdentityPublicKey,
      }),
    );

    for (const value of [signature, "", "not-a-signature"]) {
      const response = await relay.connect("mac", {
        ...headers,
        "x-mac-registration-signature": value,
      });
      expect(response.status).toBe(401);
      expect(await errorCode(response)).toBe("invalid_registration_signature");
    }
    expect(relay.registryRows.has("mac:mac-device-9")).toBe(false);
  });

  it("refuses a computer that claims a device id pinned to another key", async () => {
    await relay.register({ ...stored, signed: true });
    relay.sessionRows.delete("registration");

    const response = await relay.connect("mac", {
      "x-djl-session-secret": "s".repeat(48),
      "x-djl-notification-secret": "n".repeat(48),
      "x-mac-device-id": stored.macDeviceId,
      "x-mac-identity-public-key": key(9),
      "x-machine-name": "Impostor",
      "x-pairing-code": "XXXXXX2345",
      "x-pairing-version": "2",
      "x-pairing-expires-at": String(Date.now() + 120_000),
    });

    expect(response.status).toBe(403);
    expect(await errorCode(response)).toBe("mac_identity_mismatch");
    expect(relay.sessionRows.has("registration")).toBe(false);
    expect(relay.registryRows.get("mac:mac-device-1")).toMatchObject({ registration: stored });
    expect(relay.registryRows.has("code:XXXXXX2345")).toBe(false);
  });

  it("rejects a phone whose identity headers carry an invalid signature", async () => {
    const identity = await createIdentity();
    const signature = await identity.sign((phoneIdentityPublicKey) =>
      buildRelayPhoneConnectTranscript({
        sessionId: "another_session_1234567890",
        phoneDeviceId: "phone-9",
        phoneIdentityPublicKey,
      }),
    );

    for (const headers of [
      {
        "x-phone-device-id": "phone-9",
        "x-phone-identity-public-key": identity.publicKey,
        "x-phone-signature": signature,
      },
      { "x-phone-device-id": "phone-9" },
    ]) {
      const response = await relay.connect("iphone", headers);
      expect(response.status).toBe(401);
      expect(await errorCode(response)).toBe("invalid_phone_signature");
    }
  });
});
