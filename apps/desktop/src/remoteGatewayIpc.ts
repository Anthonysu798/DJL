// FILE: remoteGatewayIpc.ts
// Purpose: Shared main/preload channel names for the desktop remote gateway.

export const REMOTE_GATEWAY_IPC_CHANNELS = {
  state: "desktop:remote-gateway-state",
  getState: "desktop:remote-gateway-get-state",
  setEnabled: "desktop:remote-gateway-set-enabled",
  refreshPairing: "desktop:remote-gateway-refresh-pairing",
  resetPairing: "desktop:remote-gateway-reset-pairing",
  syncGroupGuests: "desktop:group-guests-sync",
  renewGroupGuestInvite: "desktop:group-guests-renew",
  groupGuests: "desktop:group-guests-state",
  listAgentLinks: "desktop:agent-links-list",
  joinGroupAsAgent: "desktop:agent-links-join",
  leaveAgentLink: "desktop:agent-links-leave",
  agentLinks: "desktop:agent-links-state",
  getReachability: "desktop:remote-reachability-get",
  setReachability: "desktop:remote-reachability-set",
} as const;
