/** Consume the desktop host secret before any provider or terminal child is spawned. */
export function takeDesktopComputerCredentials(
  env: NodeJS.ProcessEnv,
): Readonly<{ url: string; token: string }> {
  const credentials = {
    url: env.DJL_COMPUTER_USE_BRIDGE_URL ?? "",
    token: env.DJL_COMPUTER_USE_BRIDGE_TOKEN ?? "",
  };
  delete env.DJL_COMPUTER_USE_BRIDGE_URL;
  delete env.DJL_COMPUTER_USE_BRIDGE_TOKEN;
  return Object.freeze(credentials);
}

// Module evaluation precedes server startup. Keep credentials in server memory,
// rather than in the environment inherited by CLI adapters, PTYs, or tools.
export const desktopComputerCredentials = takeDesktopComputerCredentials(process.env);
