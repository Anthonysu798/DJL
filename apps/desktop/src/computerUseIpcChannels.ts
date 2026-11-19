// Preload must be able to import channels without loading schemas or Node helpers.
export const COMPUTER_USE_IPC_CHANNELS = {
  request: "desktop:computer-use-request",
  event: "desktop:computer-use-event",
} as const;
