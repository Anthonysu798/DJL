// FILE: presence.ts
// Purpose: Host presence control frames the relay pushes to phone sockets.

export interface HostPresenceFrame {
  readonly kind: "hostPresence";
  readonly online: boolean;
  readonly at: number;
}

// Plaintext by design: the relay already observes host connect and close
// times, so telling the phone adds nothing it could not infer.
export const buildHostPresenceFrame = (online: boolean, at: number): HostPresenceFrame => ({
  kind: "hostPresence",
  online,
  at,
});

export const serializeHostPresenceFrame = (online: boolean, at: number): string =>
  JSON.stringify(buildHostPresenceFrame(online, at));
