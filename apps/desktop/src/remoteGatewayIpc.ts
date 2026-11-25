// FILE: remoteGatewayIpc.ts
// Purpose: Shared main/preload channel names for the desktop remote gateway.

export const REMOTE_GATEWAY_IPC_CHANNELS = {
  state: "desktop:remote-gateway-state",
  getState: "desktop:remote-gateway-get-state",
  setEnabled: "desktop:remote-gateway-set-enabled",
  refreshPairing: "desktop:remote-gateway-refresh-pairing",
  resetPairing: "desktop:remote-gateway-reset-pairing",
  getReachability: "desktop:remote-reachability-get",
  setReachability: "desktop:remote-reachability-set",
} as const;
