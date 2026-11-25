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

export type GroupTemplateId =
  | "buildReview"
  | "planBuildReview"
  | "researchWrite"
  | "secondOpinions";
type TemplateRole = "planner" | "builder" | "reviewer" | "researcher" | "writer";
type TemplateSlot = { role: TemplateRole | null; lead?: boolean; reviewer?: boolean };
export type TemplateMember = {
  provider: GroupMemberProvider;
  role?: TemplateRole;
  lead?: boolean;
  reviewer?: boolean;
};

const ANY_ORDER: readonly GroupMemberProvider[] = [
  "claudeAgent",
  "codex",
  "gemini",
  "cursor",
  "kimi",
  "qwen",
  "grok",
  "codebuddy",
  "iflow",
  "pi",
];
// Who tends to suit each job, best first; anything else ready comes after.
const ROLE_ORDER: Record<TemplateRole, readonly GroupMemberProvider[]> = {
  planner: ["claudeAgent", "gemini", "codex"],
  builder: ["codex", "claudeAgent", "cursor"],
  reviewer: ["claudeAgent", "codex", "gemini"],
  researcher: ["gemini", "claudeAgent", "kimi"],
  writer: ["claudeAgent", "gemini", "qwen"],
};

export const GROUP_TEMPLATES: readonly {
  id: GroupTemplateId;
  slots: readonly TemplateSlot[];
  defaultRecipient?: "all";
}[] = [
  {
    id: "buildReview",
    slots: [{ role: "builder" }, { role: "reviewer", reviewer: true }],
  },
  {
    id: "planBuildReview",
    slots: [
      { role: "planner", lead: true },
      { role: "builder" },
      { role: "reviewer", reviewer: true },
    ],
  },
  { id: "researchWrite", slots: [{ role: "researcher" }, { role: "writer" }] },
  {
    id: "secondOpinions",
    slots: [{ role: null }, { role: null }, { role: null }],
    defaultRecipient: "all",
  },
];

/**
 * Fills a template's slots from the agents that are ready, giving each slot a different agent
 * while there are enough, then reusing them (one agent can join twice with different roles).
 * Second opinions needs different agents, so it stops at the number of ready agents.
 */
export function fillTemplate(
  templateId: GroupTemplateId,
  readyProviders: readonly GroupMemberProvider[],
): TemplateMember[] {
  const template = GROUP_TEMPLATES.find((entry) => entry.id === templateId);
  if (!template || readyProviders.length === 0) return [];
  const ready = new Set(readyProviders);
  const used: GroupMemberProvider[] = [];
  const slots =
    templateId === "secondOpinions" ? template.slots.slice(0, ready.size) : template.slots;
  return slots.map((slot) => {
    const order = [...(slot.role ? ROLE_ORDER[slot.role] : []), ...ANY_ORDER].filter((provider) =>
      ready.has(provider),
    );
    const provider = order.find((entry) => !used.includes(entry)) ?? order[0]!;
    used.push(provider);
    const member: TemplateMember = { provider };
    if (slot.role) member.role = slot.role;
    if (slot.lead) member.lead = true;
    if (slot.reviewer) member.reviewer = true;
    return member;
  });
}

export function templateDefaultRecipient(templateId: GroupTemplateId): "all" | undefined {
  return GROUP_TEMPLATES.find((entry) => entry.id === templateId)?.defaultRecipient;
}
