// FILE: groupPrompt.ts
// Purpose: Builds the plain-text prompt one group member receives: a first-wake briefing, the
//          group messages it has not seen, and the new message addressed to it.
// Layer: Native harness (group)

export type PromptMember = {
  id: string;
  handle: string;
  providerName: string;
  role: string | null;
};
export type PromptLogEntry = { seq: number; authorLabel: string; text: string };

export function selectMissed(
  entries: PromptLogEntry[],
  limit: number,
): { missed: PromptLogEntry[]; skipped: number } {
  const skipped = Math.max(0, entries.length - limit);
  return { missed: entries.slice(skipped), skipped };
}

function briefingLines(input: {
  groupName: string;
  self: PromptMember;
  members: PromptMember[];
  skills: { name: string; description: string; path: string }[];
}): string[] {
  const members = input.members.map((member) => {
    const details = [member.providerName, member.role].filter(Boolean).join(", ");
    const you = member.id === input.self.id ? " — this is you" : "";
    return `- @${member.handle} (${details})${you}`;
  });
  const lines = [
    `You are @${input.self.handle} in a DJL group chat named "${input.groupName}".`,
    "The people in this chat are the user and these agents:",
    ...members,
    "",
    "How this chat works:",
    "- Reply with your answer only; it is posted to the group under your name.",
    "- Writing @handle in your reply hands the conversation to that agent. Do this only when you",
    "  need their help. Writing @all yourself does nothing.",
    "- Answer in the language of the message you are replying to.",
    "- Keep any files you create or change inside the current working folder.",
  ];
  if (input.skills.length > 0) {
    lines.push(
      "",
      "Skills you can use (open the SKILL.md file and follow it when the task fits):",
      ...input.skills.map((skill) => `- ${skill.name}: ${skill.description} (${skill.path})`),
    );
  }
  return lines;
}

export function buildMemberPrompt(input: {
  groupName: string;
  self: PromptMember;
  members: PromptMember[];
  skills: { name: string; description: string; path: string }[];
  briefing: boolean;
  missed: PromptLogEntry[];
  skipped: number;
  message: { fromLabel: string; text: string };
  proposeOnly: boolean;
  attachments: string[];
  pastedSkills: { name: string; markdown: string }[];
}): string {
  const sections: string[] = [];
  if (input.briefing) sections.push(briefingLines(input).join("\n"));
  if (input.missed.length > 0) {
    const header =
      input.skipped > 0
        ? `Group messages since you last spoke (${input.skipped} earlier messages were skipped):`
        : "Group messages since you last spoke:";
    sections.push(
      [header, ...input.missed.map((entry) => `[${entry.authorLabel}] ${entry.text}`)].join("\n"),
    );
  }
  if (input.proposeOnly) {
    sections.push(
      "Everyone in the group was asked at once, so you cannot change files or run commands this" +
        " turn. You may read files and look things up. Propose what you would do; the user will" +
        " pick one agent to carry it out.",
    );
  }
  if (input.attachments.length > 0) {
    sections.push(["Attached files:", ...input.attachments.map((path) => `- ${path}`)].join("\n"));
  }
  for (const skill of input.pastedSkills) {
    sections.push(`Use this skill (${skill.name}):\n${skill.markdown}`);
  }
  sections.push(`New message from ${input.message.fromLabel}:\n${input.message.text}`);
  return sections.join("\n\n");
}
