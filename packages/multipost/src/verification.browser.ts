import { afterEach, expect, it } from "vitest";
import { buildVerificationScript } from "./browser";

const expected = {
  adapterId: "DYNAMIC_INSTAGRAM",
  username: "qa.owner",
  submittedAt: "2026-11-09T12:00:00.200Z",
  data: { title: "Reviewed title", content: "Reviewed caption", tags: ["test"] },
};
function verify(url = "https://www.instagram.com/p/qa_new/", state?: unknown) {
  return new Function(
    "document",
    "location",
    "globalThis",
    `return ${buildVerificationScript(expected)}`,
  )(document, { href: url }, { __djlMultiPost: state });
}
function post() {
  const root = document.createElement("section");
  root.setAttribute("data-verification-fixture", "");
  root.innerHTML = `<article><h2><a href="https://www.instagram.com/qa.owner/">qa.owner</a></h2><h1>Reviewed title<br>Reviewed caption #test</h1><a href="https://www.instagram.com/qa.owner/p/qa_new/"><time datetime="2026-11-09T12:00:03.000Z">3 seconds ago</time></a></article>`;
  document.body.append(root);
  return root;
}
afterEach(() => {
  document.querySelectorAll("[data-verification-fixture]").forEach((node) => node.remove());
});
it("recovers a submitted Instagram result from its matching author, caption, permalink and timestamp", () => {
  post();
  expect(verify()).toMatchObject({
    state: "published",
    postUrl: "https://www.instagram.com/p/qa_new/",
  });
});
it("recovers the direct desktop permalink layout without article or heading wrappers", () => {
  const root = post();
  root.innerHTML = `<main><a href="https://www.instagram.com/qa.owner/">qa.owner</a><div><a href="https://www.instagram.com/qa.owner/">qa.owner</a><span>Reviewed title<br>Reviewed caption #test</span></div><a href="https://www.instagram.com/qa.owner/p/qa_new/"><time datetime="2026-11-09T12:00:03.000Z">3 seconds ago</time></a></main>`;
  expect(verify()).toMatchObject({
    state: "published",
    postUrl: "https://www.instagram.com/p/qa_new/",
  });
  root.querySelector("main > a")!.setAttribute("href", "https://www.instagram.com/someone.else/");
  expect(verify().state).toBe("uncertain");
});
it("rejects old, wrong-author, wrong-caption and wrong-permalink posts", () => {
  const root = post();
  root.querySelector("time")!.setAttribute("datetime", "2026-11-08T12:00:00.000Z");
  expect(verify().state).toBe("uncertain");
  root.querySelector("time")!.setAttribute("datetime", "2026-11-09T12:00:03.000Z");
  root.querySelector("h2 a")!.setAttribute("href", "https://www.instagram.com/someone.else/");
  expect(verify().state).toBe("uncertain");
  root.querySelector("h2 a")!.setAttribute("href", "https://www.instagram.com/qa.owner/");
  root.querySelector("h1")!.textContent = "Different content";
  expect(verify().state).toBe("uncertain");
  root.querySelector("h1")!.innerHTML = "Reviewed title<br>Reviewed caption #test";
  expect(verify("https://www.instagram.com/p/different/").state).toBe("uncertain");
  expect(verify("https://www.instagram.com/").state).toBe("uncertain");
  expect(verify("https://www.instagram.com.evil.test/p/qa_new/").state).toBe("uncertain");
});
it("recognizes only a new provider-owned share confirmation after dispatch", () => {
  const root = document.createElement("section");
  root.setAttribute("data-verification-fixture", "");
  root.innerHTML =
    '<div role="dialog" aria-label="Post shared"><h3>Your post has been shared.</h3></div>';
  document.body.append(root);
  expect(
    verify("https://www.instagram.com/", { dispatched: true, submissionHeadings: [] }),
  ).toMatchObject({ state: "published", providerConfirmation: "instagram-post-shared" });
  expect(
    verify("https://www.instagram.com/", {
      dispatched: true,
      submissionHeadings: ["Your post has been shared."],
    }).state,
  ).toBe("uncertain");
  expect(
    verify("https://www.instagram.com/", { dispatched: false, submissionHeadings: [] }).state,
  ).toBe("uncertain");
  expect(
    verify("https://www.instagram.com.evil.test/", { dispatched: true, submissionHeadings: [] })
      .state,
  ).toBe("uncertain");
});
