/** Closure-free: serialized into the account page alongside the adapter. */
export function assertPreparedContent(
  adapterId: string,
  data: { title?: string; content?: string; tags?: string[] },
  doc: Document,
  pending: number,
) {
  if (adapterId !== "DYNAMIC_INSTAGRAM" || pending === 0) return;
  const tagSuffix = data.tags?.length ? ` ${data.tags.map((tag) => `#${tag}`).join(" ")}` : "";
  const expected = `${data.title ? `${data.title}\n` : ""}${data.content || ""}${tagSuffix}`
    .replace(/\s+/g, " ")
    .trim();
  const editors = doc.querySelectorAll<HTMLElement>(
    '[contenteditable="true"][role="textbox"][data-lexical-editor="true"]',
  );
  if (
    !Array.from(editors).some((editor) => editor.innerText.replace(/\s+/g, " ").trim() === expected)
  ) {
    throw new Error("Instagram caption does not match the reviewed content; submission stopped.");
  }
}
