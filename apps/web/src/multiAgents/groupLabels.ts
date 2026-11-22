// FILE: groupLabels.ts
// Purpose: Localized labels for group roles; a custom role is shown as typed.
// Layer: Web logic

import { GROUP_ROLE_PRESETS } from "@djl/contracts";
import type { TFunction } from "i18next";

export function isPresetRole(role: string): role is (typeof GROUP_ROLE_PRESETS)[number] {
  return (GROUP_ROLE_PRESETS as readonly string[]).includes(role);
}

export function roleLabel(t: TFunction<"shell">, role: string): string {
  return isPresetRole(role) ? t(`multiAgents.roles.${role}`) : role;
}
