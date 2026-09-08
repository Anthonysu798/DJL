import { Schema } from "effect";
import { UserInputQuestion, type UserInputQuestion as Question } from "@synara/contracts";
import { object, string } from "./protocol";

/** Claude keys answers by question text; Codex provides an explicit question id. */
export function nativeQuestions(args: unknown): Question[] {
  const questions = object(args).questions;
  if (!Array.isArray(questions) || questions.length === 0)
    throw new Error("Native user-input request has no questions");
  return questions.map((entry) => {
    const question = object(entry);
    const text = string(question.question);
    return Schema.decodeUnknownSync(UserInputQuestion)({
      id: question.id ?? text,
      header: question.header ?? "Question",
      question: text,
      options: Array.isArray(question.options)
        ? question.options.map((entry) => {
            const option = object(entry);
            return { label: string(option.label), description: option.description || option.label };
          })
        : [],
      multiSelect: question.multiSelect === true,
    });
  });
}

/** Only detail survives ingestion into approval activities; put the proposed action first. */
export function nativeApprovalDetail(args: unknown): string {
  const request = object(args);
  const toolCall = request.toolCall ? object(request.toolCall) : {};
  const item = request.item ? object(request.item) : {};
  const context = {
    command: request.command ?? item.command,
    tool: request.tool ?? toolCall.title,
    input: request.input ?? toolCall.rawInput,
    changes: item.changes,
    locations: toolCall.locations,
    cwd: request.cwd ?? item.cwd,
    grantRoot: request.grantRoot,
    reason: request.reason,
  };
  const detail = JSON.stringify(context, null, 2);
  return detail === "{}" ? JSON.stringify(request, null, 2) : detail;
}
