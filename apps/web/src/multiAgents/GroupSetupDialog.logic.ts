// FILE: GroupSetupDialog.logic.ts
// Purpose: Which agents a new group can include, whether each is ready, and a default name.
// Layer: Web logic

import {
  GROUP_MEMBER_PROVIDERS,
  PROVIDER_DISPLAY_NAMES,
  type GroupMemberProvider,
  type HarnessAccount,
} from "@djl/contracts";

/** `ready` is null when the account check failed and readiness is unknown. */
export type MemberChoice = { provider: GroupMemberProvider; ready: boolean | null };
export type AccountCheck = { checkFailed?: boolean };

const readyIn = (accounts: readonly HarnessAccount[], provider: GroupMemberProvider) =>
  accounts.some((account) => account.id === provider && account.status === "ready");

/** Every member kind, ready ones first; the rest are shown with a Set up button. */
export function memberChoices(
  accounts: readonly HarnessAccount[],
  check: AccountCheck = {},
): MemberChoice[] {
  if (check.checkFailed)
    return GROUP_MEMBER_PROVIDERS.map((provider) => ({ provider, ready: null }));
  const choices = GROUP_MEMBER_PROVIDERS.map((provider) => ({
    provider,
    ready: readyIn(accounts, provider),
  }));
  return [
    ...choices.filter((choice) => choice.ready),
    ...choices.filter((choice) => !choice.ready),
  ];
}

/** A failed check does not block the user: an agent that is not set up reports it in the chat. */
export function canCreate(
  selected: readonly GroupMemberProvider[],
  accounts: readonly HarnessAccount[],
  check: AccountCheck = {},
): boolean {
  if (check.checkFailed) return selected.length > 0;
  return selected.some((provider) => readyIn(accounts, provider));
}

const NAME_LIMIT = 3;

export function defaultGroupName(selected: readonly GroupMemberProvider[]): string {
  const names = selected.slice(0, NAME_LIMIT).map((provider) => PROVIDER_DISPLAY_NAMES[provider]);
  const extra = selected.length - NAME_LIMIT;
  return extra > 0 ? `${names.join(", ")} +${extra}` : names.join(", ");
}
