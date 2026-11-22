/** Embedded identity for local Computer acceptance packages; production remains unchanged. */
export const COMPUTER_QA_BUILD = {
  marker: "cua-qa",
  displayName: "DJL Computer QA",
  bundleId: "com.djl.qa.computer-use",
  profileDirectory: "DJL Computer QA r40",
} as const;
export function isComputerQaBuild(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    "djlComputerBuild" in value &&
    value.djlComputerBuild === COMPUTER_QA_BUILD.marker
  );
}

/** An isolated QA backend must not borrow provider credentials or configuration. */
export function computerQaBackendEnvironment(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const blocked = new Set([
    "OPENCODE_CONFIG",
    "OPENCODE_CONFIG_CONTENT",
    "OPENCODE_CONFIG_DIR",
    "CODEX_HOME",
    "CLAUDE_CONFIG_DIR",
    "SSH_AUTH_SOCK",
    "VITE_DEV_SERVER_URL",
  ]);
  const clean: NodeJS.ProcessEnv = {};
  for (const name of Object.keys(base)) {
    if (!blocked.has(name) && !/API_KEY|TOKEN|PASSWORD|SECRET|CREDENTIAL/i.test(name))
      clean[name] = base[name];
  }
  return clean;
}
