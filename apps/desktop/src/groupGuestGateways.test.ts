import { describe, expect, it } from "vitest";

import {
  MAX_GUEST_GATEWAYS,
  guestGatewayEnv,
  guestInviteNeedsRenewal,
  guestStateDir,
  initialGuestLink,
  parseGuestInvites,
  planGuestSync,
  reduceGuestLink,
} from "./groupGuestGateways";

const invite = (guestId: string, patch: Record<string, unknown> = {}) => ({
  guestId,
  groupId: "group-1",
  threadId: "thread-1",
  groupName: "Launch",
  name: "Alex",
  role: "chat" as const,
  ...patch,
});
const ALEX = "a1b2c3d4e5f60718";
const SAM = "ffffffffffffffff";

describe("guest invites from the renderer", () => {
  it("keeps well-formed invites and drops everything else", () => {
    expect(
      parseGuestInvites([
        invite(ALEX),
        invite("../../etc"),
        invite("UPPERCASE1234"),
        invite(SAM, { role: "owner" }),
        invite(SAM, { threadId: "" }),
        invite(SAM, { name: "x".repeat(41) }),
        null,
        "nonsense",
      ]),
    ).toEqual([invite(ALEX)]);
    expect(parseGuestInvites("nonsense")).toEqual([]);
  });

  it("carries only the fields it knows", () => {
    const [parsed] = parseGuestInvites([{ ...invite(ALEX), extra: "DJL_RELAY=evil" }]);
    expect(parsed).toEqual(invite(ALEX));
  });

  it("caps how many gateways can run", () => {
    const many = Array.from({ length: MAX_GUEST_GATEWAYS + 5 }, (_, index) =>
      invite(`guest${String(index).padStart(8, "0")}`),
    );
    expect(parseGuestInvites(many)).toHaveLength(MAX_GUEST_GATEWAYS);
  });
});

describe("guest state", () => {
  it("lives in a folder named after the guest, and rejects ids that could leave it", () => {
    expect(guestStateDir("/base", ALEX)).toBe(`/base/remote-guests/${ALEX}`);
    expect(() => guestStateDir("/base", "../owner")).toThrow("Invalid guest id");
    expect(() => guestStateDir("/base", "")).toThrow("Invalid guest id");
  });

  it("gives each guest its own identity, its own Keychain mirror and a one-group scope", () => {
    const env = guestGatewayEnv({
      base: { PATH: "/usr/bin", DJL_DEVICE_STATE_DIR: "/owner/remote", DJL_KEEP_MAC_AWAKE: "1" },
      invite: invite(ALEX, { role: "viewer" }),
      baseDir: "/base",
      relayUrl: "wss://relay.test/relay",
      backendWsUrl: "ws://127.0.0.1:1/?token=t",
      desktopVersion: "1.2.3",
    });
    const dir = `/base/remote-guests/${ALEX}`;
    expect(env.DJL_DEVICE_STATE_DIR).toBe(dir);
    expect(env.DJL_DEVICE_STATE_FILE).toBe(`${dir}/device-state.json`);
    expect(env.DJL_DEVICE_STATE_KEYCHAIN_MOCK_FILE).toBe(`${dir}/identity-mirror.json`);
    expect(JSON.parse(env.DJL_GUEST_SCOPE!)).toEqual({
      guestId: ALEX,
      groupId: "group-1",
      threadId: "thread-1",
      role: "viewer",
      name: "Alex",
    });
    expect(env.DJL_BRIDGE_DISPLAY_NAME).toBe("Launch (DJL group)");
    expect(env.DJL_PUSH_SERVICE_URL).toBe("");
    expect(env.DJL_KEEP_MAC_AWAKE).toBe("0");
    expect(env.PATH).toBe("/usr/bin");
  });
});

describe("keeping gateways in step with the guest list", () => {
  it("starts new guests, restarts changed ones and removes the rest", () => {
    const running = new Map([
      [ALEX, invite(ALEX)],
      [SAM, invite(SAM, { name: "Sam" })],
    ]);
    const third = invite("0000000000000001", { name: "Kim" });
    expect(planGuestSync(running, [invite(ALEX, { role: "viewer" }), third])).toEqual({
      start: [third],
      restart: [invite(ALEX, { role: "viewer" })],
      remove: [SAM],
    });
    expect(planGuestSync(running, [invite(ALEX), invite(SAM, { name: "Sam" })])).toEqual({
      start: [],
      restart: [],
      remove: [],
    });
  });
});

describe("a guest's link", () => {
  const link = initialGuestLink(invite(ALEX));
  const status = (patch: Record<string, unknown>) => ({
    type: "status",
    status: { state: "running", connectionStatus: "connected", ...patch },
  });

  it("shows the invite code, then that the guest connected", () => {
    const withCode = reduceGuestLink(link, {
      type: "pairing",
      pairingCode: "ABCDE23456",
      pairingPayload: { v: 2, sessionId: "s", expiresAt: 5_000 },
    }).link;
    expect(withCode).toMatchObject({ pairingCode: "ABCDE23456", pairingExpiresAt: 5_000 });
    const waiting = reduceGuestLink(withCode, status({ phonePaired: false }));
    expect(waiting.link.status).toBe("waiting");
    expect(waiting.paired).toBe(false);
    const connected = reduceGuestLink(
      waiting.link,
      status({ phonePaired: true, activeDevice: { connected: true, phoneFingerprint: "ab12" } }),
    );
    expect(connected.link.status).toBe("connected");
    expect(connected.paired).toBe(true);
  });

  it("reports errors and ignores messages it does not know", () => {
    expect(
      reduceGuestLink(link, status({ state: "error", lastError: "relay down" })).link,
    ).toMatchObject({ status: "error", message: "relay down" });
    expect(reduceGuestLink(link, { type: "open-thread", threadId: "t" }).link).toBe(link);
    expect(reduceGuestLink(link, null).link).toBe(link);
  });

  it("renews an expired code only for a guest who never paired", () => {
    const expired = { ...link, status: "waiting" as const, pairingExpiresAt: 1_000 };
    expect(guestInviteNeedsRenewal({ link: expired, paired: false, now: 2_000 })).toBe(true);
    expect(guestInviteNeedsRenewal({ link: expired, paired: true, now: 2_000 })).toBe(false);
    expect(guestInviteNeedsRenewal({ link: expired, paired: false, now: 500 })).toBe(false);
    expect(
      guestInviteNeedsRenewal({
        link: { ...expired, status: "connected" },
        paired: false,
        now: 2_000,
      }),
    ).toBe(false);
  });
});
