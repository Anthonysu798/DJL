import {
  MCP_MENTION_PREFIX,
  type ComputerControlMode,
  type ProviderMentionReference,
  type ProviderSkillReference,
} from "@djl/contracts";
import { parseComputerInvocation } from "@djl/shared/computerInvocation";

/** Resolved only from user-authored text and structured references at trusted ingress. */
export function resolveDjlComputerIntent(input: {
  readonly enableComputerControl?: boolean | undefined;
  readonly dispatchOrigin?: string | undefined;
  readonly message: {
    readonly text: string;
    readonly mentions?: readonly ProviderMentionReference[] | undefined;
    readonly skills?: readonly ProviderSkillReference[] | undefined;
  };
}): { mode: ComputerControlMode; explicitInvocation: boolean } {
  if (input.dispatchOrigin !== undefined && input.dispatchOrigin !== "user")
    return { mode: "off", explicitInvocation: false };
  const explicitInvocation =
    parseComputerInvocation(input.message.text) !== null ||
    input.message.mentions?.some(
      (ref) =>
        ref.path === "plugin://djl/computer-use" ||
        ref.path.startsWith(
          `${MCP_MENTION_PREFIX}${encodeURIComponent("plugin://djl/computer-use")}/`,
        ),
    ) === true ||
    input.message.skills?.some((ref) => ref.path === "builtin://djl/computer-use/operate") === true;
  return {
    mode: input.enableComputerControl === true ? "chat" : explicitInvocation ? "request" : "off",
    explicitInvocation,
  };
}
