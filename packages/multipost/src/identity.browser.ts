import { afterEach, describe, expect, it } from "vitest";
import { buildIdentityScript } from "./browser";
const roots: HTMLElement[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) root.remove();
});
const link = (path: string, text: string) =>
  `<a href="https://www.instagram.com${path}">${text}</a>`;
const avatar = (name: string) => link(`/${name}/`, `<img alt="${name}'s profile picture">`);
const nav = (profile: string) =>
  `<div>${link("/", '<svg aria-label="Home"></svg>')}${link("/reels/", '<svg aria-label="Reels"></svg>')}${link("/direct/inbox/", '<svg aria-label="Messages"></svg>')}${profile}</div>`;
function fixture(html: string) {
  const root = document.createElement("section");
  root.innerHTML = html;
  document.body.append(root);
  roots.push(root);
  return root;
}
const identify = (href = "https://www.instagram.com/") =>
  new Function("location", `return ${buildIdentityScript("instagram")}`)(new URL(href));
describe("authenticated Instagram navigation identity", () => {
  it("uses the own-profile avatar inside the signed-in navigation, not a feed account", async () => {
    fixture(
      nav(avatar("qa.owner")) +
        `<main>${avatar("different.person")}${link("/p/old-post/", "Existing post")}</main>`,
    );
    expect(await identify()).toMatchObject({
      provider: "instagram",
      accountId: "qa.owner",
      username: "qa.owner",
    });
  });
  it("waits for navigation rendered after page load", async () => {
    const root = fixture("");
    setTimeout(() => {
      root.innerHTML = nav(avatar("qa.owner"));
    }, 30);
    expect(await identify()).toMatchObject({ accountId: "qa.owner" });
  });
  it("does not turn a feed avatar into the logged-in identity", async () => {
    fixture(nav("") + `<main>${avatar("different.person")}</main>`);
    expect(await identify()).toBeNull();
  });
  it("rejects ambiguous navigation and a different page origin", async () => {
    const root = fixture(nav(avatar("one.owner") + avatar("second.owner")));
    expect(await identify()).toBeNull();
    root.innerHTML = nav(avatar("qa.owner"));
    expect(await identify("https://foreign.example/")).toBeNull();
  });
});
