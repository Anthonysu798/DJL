// FILE: chatThreads.ts
// Purpose: Shared chat-thread title helpers used by web and server flows.
// Layer: Shared util
// Exports: generic title checks plus fallback/generated title sanitizers

export const GENERIC_CHAT_THREAD_TITLE = "New thread";
const MAX_CHAT_THREAD_TITLE_LENGTH = 60;
// Single source for the title word cap. Exported so the server-side title prompt
// (textGenerationShared.buildThreadTitlePrompt) derives its wording and fallback
// limits from the same number the sanitizers enforce here.
export const MAX_CHAT_THREAD_TITLE_WORDS = 6;

function normalizeTitleWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function trimTitleToken(token: string): string {
  return token.replace(/^[\s"'`([{]+|[\s"'`)\]}:;,.!?]+$/g, "");
}

function titleWords(value: string): string[] {
  return normalizeTitleWhitespace(value)
    .split(" ")
    .map(trimTitleToken)
    .filter((token) => token.length > 0);
}

function containsProviderProtocolMarkup(value: string): boolean {
  return (
    /<\s*\/?\s*(?:tool_calls?|parameter|function_calls?|assistant|analysis|final)\b/i.test(value) ||
    /<\/?｜{1,2}DSML｜{1,2}(?:tool_calls|invoke|parameter)\b/u.test(value)
  );
}

/** True only when the complete assistant text is a raw provider protocol envelope. */
export function isProviderProtocolOnlyText(value: string | null | undefined): boolean {
  const trimmed = value?.trim() ?? "";
  if (trimmed.length === 0) return false;
  if (
    /^<｜{1,2}DSML｜{1,2}tool_calls>[\s\S]*<\/｜{1,2}DSML｜{1,2}tool_calls>$/u.test(trimmed) ||
    /^<\s*(?:tool_calls?|function_calls?)\b[^>]*>[\s\S]*<\/\s*(?:tool_calls?|function_calls?)\s*>$/i.test(
      trimmed,
    )
  ) {
    return true;
  }

  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return false;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return false;
    const envelope = parsed as Record<string, unknown>;
    const name = envelope.name ?? envelope.function_name;
    if (typeof name === "string" && Object.hasOwn(envelope, "arguments")) return true;
    return (
      Array.isArray(envelope.tool_calls) &&
      envelope.tool_calls.length > 0 &&
      envelope.tool_calls.every((call) => {
        if (call === null || typeof call !== "object" || Array.isArray(call)) return false;
        const functionCall = (call as Record<string, unknown>).function;
        return (
          functionCall !== null &&
          typeof functionCall === "object" &&
          typeof (functionCall as Record<string, unknown>).name === "string"
        );
      })
    );
  } catch {
    return false;
  }
}

export function truncateChatThreadTitle(
  text: string,
  maxLength = MAX_CHAT_THREAD_TITLE_LENGTH,
): string {
  const trimmed = normalizeTitleWhitespace(text);
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxLength)}...`;
}

// Build a short deterministic title while the model-generated rename is pending.
export function buildPromptThreadTitleFallback(message: string): string {
  const words = titleWords(message).slice(0, MAX_CHAT_THREAD_TITLE_WORDS);
  if (words.length === 0) {
    return GENERIC_CHAT_THREAD_TITLE;
  }
  return truncateChatThreadTitle(words.join(" "));
}

// Keep generated titles compact so the sidebar never renders sentence-length prompts.
export function sanitizeGeneratedThreadTitle(raw: string): string {
  const unquoted = normalizeTitleWhitespace(raw).replace(/^['"`]+|['"`]+$/g, "");
  if (containsProviderProtocolMarkup(unquoted) || isProviderProtocolOnlyText(unquoted)) {
    return GENERIC_CHAT_THREAD_TITLE;
  }
  const words = titleWords(unquoted).slice(0, MAX_CHAT_THREAD_TITLE_WORDS);
  if (words.length === 0) {
    return GENERIC_CHAT_THREAD_TITLE;
  }
  return truncateChatThreadTitle(words.join(" "));
}

export function isGenericChatThreadTitle(title: string | null | undefined): boolean {
  return normalizeTitleWhitespace(title ?? "") === GENERIC_CHAT_THREAD_TITLE;
}
