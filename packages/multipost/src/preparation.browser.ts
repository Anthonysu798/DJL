import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { buildPreparationScript } from "./browser";
const fixture = vi.hoisted(() => ({
  source: "return async ()=>{globalThis.__djlMultiPost.defer(async()=>{});};",
}));
vi.mock("./index", () => ({
  identitySources: {},
  getAdapter: () => ({
    id: "DYNAMIC_INSTAGRAM",
    kind: "dynamic",
    automaticSubmit: true,
    source: fixture.source,
  }),
}));
afterEach(() => {
  for (const node of document.querySelectorAll("[data-qa-caption]")) node.remove();
  vi.restoreAllMocks();
});
beforeEach(() => {
  fixture.source = "return async ()=>{globalThis.__djlMultiPost.defer(async()=>{});};";
});
it("ignores unrelated platform background errors without replacing the page console", async () => {
  const original = vi.spyOn(console, "error").mockImplementation(() => {});
  fixture.source = `return async ()=>{globalThis.console.error('Unable to fetch crossposting metadata');globalThis.__djlMultiPost.defer(async()=>{});};`;
  const execute = new Function(
    `return ${buildPreparationScript("DYNAMIC_WEBHOOK", { title: "QA" }, {})}`,
  );
  await expect(execute()).resolves.toMatchObject({ done: true, pending: 1 });
  expect(console.error).toBe(original);
});
it("continues to reject an error logged by the adapter itself", async () => {
  fixture.source = `return async ()=>{console.error('Media preparation failed');};`;
  const execute = new Function(
    `return ${buildPreparationScript("DYNAMIC_WEBHOOK", { title: "QA" }, {})}`,
  );
  await expect(execute()).rejects.toThrow("Media preparation failed");
});
it("refuses automatic submission when the reviewed Instagram caption was not filled", async () => {
  const execute = new Function(
    `return ${buildPreparationScript("DYNAMIC_INSTAGRAM", { title: "Reviewed title", content: "Reviewed exact caption" }, {})}`,
  );
  await expect(execute()).rejects.toThrow(/Instagram.*caption/i);
});
it("accepts the exact title, caption and tags after editor whitespace normalization", async () => {
  fixture.source = `return async ()=>{const field=document.createElement('div');field.setAttribute('data-qa-caption','');field.setAttribute('role','textbox');field.setAttribute('contenteditable','true');field.setAttribute('data-lexical-editor','true');field.innerText=${JSON.stringify("Reviewed title\nReviewed exact caption #test")};document.body.append(field);globalThis.__djlMultiPost.defer(async()=>{});};`;
  const execute = new Function(
    `return ${buildPreparationScript("DYNAMIC_INSTAGRAM", { title: "Reviewed title", content: "Reviewed exact caption", tags: ["test"] }, {})}`,
  );
  await expect(execute()).resolves.toMatchObject({ done: true, pending: 1 });
});
