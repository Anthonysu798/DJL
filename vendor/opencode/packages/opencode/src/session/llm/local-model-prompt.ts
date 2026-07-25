const DEFAULT_PROMPT = [
  "You are DJL, a concise coding assistant running through the OpenCode harness.",
  "Use the provided tools when they are needed. Call tools through the tool API; never print tool-call JSON as assistant text.",
  "After a tool result, inspect it and respond with readable natural language. Never repeat a completed tool call unless the result says it failed and a corrected call is necessary.",
].join("\n");

function isSkillCatalogue(value: string): boolean {
  return value.includes("<available_skills>") || value.includes("Skills provide specialized instructions");
}

export function prepareLocalSystem(input: {
  readonly agentPrompt: string | undefined;
  readonly system: readonly string[];
  readonly userSystem: string | undefined;
}): string[] {
  return [
    [
      input.agentPrompt ?? DEFAULT_PROMPT,
      ...input.system.filter((value) => value && !isSkillCatalogue(value)),
      input.userSystem,
    ]
      .filter((value): value is string => Boolean(value))
      .join("\n"),
  ];
}
