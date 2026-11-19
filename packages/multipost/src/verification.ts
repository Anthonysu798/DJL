export interface VerificationContext {
  adapterId: string;
  username?: string;
  submittedAt: string | null;
  data: { title?: string; content?: string; tags?: string[] };
}

/** Closure-free; reads provider evidence in the dedicated account page. */
export function readInstagramEvidence(
  doc: Document,
  pageUrl: string,
  expected: VerificationContext | undefined,
  state?: { dispatched?: boolean; submissionHeadings?: string[] },
) {
  if (expected?.adapterId !== "DYNAMIC_INSTAGRAM" || !expected.submittedAt) return null;
  let page: URL;
  try {
    page = new URL(pageUrl);
  } catch {
    return null;
  }
  if (page.protocol !== "https:" || !["instagram.com", "www.instagram.com"].includes(page.hostname))
    return null;
  const observedAt = new Date().toISOString();
  const confirmation = doc.querySelector('[role="dialog"][aria-label="Post shared"] h3');
  if (
    state?.dispatched &&
    Array.isArray(state.submissionHeadings) &&
    confirmation?.textContent === "Your post has been shared." &&
    !state.submissionHeadings.includes(confirmation.textContent)
  )
    return {
      state: "published" as const,
      providerConfirmation: "instagram-post-shared" as const,
      message: "Instagram confirmed that the post was shared.",
      observedAt,
    };

  const path = /^\/(?:([A-Za-z0-9._]+)\/)?(p|reel)\/([A-Za-z0-9_-]+)\/?$/.exec(page.pathname);
  const username = expected.username?.toLowerCase();
  const submittedAt = Date.parse(expected.submittedAt);
  if (
    !path ||
    !username ||
    !Number.isFinite(submittedAt) ||
    (path[1] && path[1].toLowerCase() !== username)
  )
    return null;
  const data = expected.data;
  const caption =
    `${data.title ? `${data.title}\n` : ""}${data.content || ""}${data.tags?.length ? ` ${data.tags.map((tag) => `#${tag}`).join(" ")}` : ""}`
      .replace(/\s+/g, " ")
      .trim();
  if (!caption) return null;
  const articles = doc.querySelectorAll("article");
  const scopes = articles.length ? articles : doc.querySelectorAll("main");
  for (const article of Array.from(scopes)) {
    const author = Array.from(article.querySelectorAll<HTMLAnchorElement>("a[href]")).find((link) =>
      link.textContent?.trim(),
    );
    if (!author) continue;
    const owner = new URL(author.href, page);
    if (owner.origin !== page.origin || owner.pathname.toLowerCase() !== `/${username}/`) continue;
    if (
      !Array.from(article.querySelectorAll<HTMLElement>("h1,span")).some((node) => {
        if (node.innerText.replace(/\s+/g, " ").trim() !== caption) return false;
        let parent = node.parentElement;
        while (parent && article.contains(parent)) {
          const ownerLink = Array.from(parent.querySelectorAll<HTMLAnchorElement>("a[href]")).find(
            (link) => link.textContent?.trim(),
          );
          if (ownerLink) {
            const captionOwner = new URL(ownerLink.href, page);
            return (
              captionOwner.origin === page.origin &&
              captionOwner.pathname.toLowerCase() === `/${username}/`
            );
          }
          parent = parent.parentElement;
        }
        return false;
      })
    )
      continue;
    const timestamp = Array.from(article.querySelectorAll("a[href] time[datetime]")).find(
      (node) => {
        const link = node.closest<HTMLAnchorElement>("a[href]")!;
        const target = new URL(link.href, page);
        const publishedAt = Date.parse(node.getAttribute("datetime") ?? "");
        return (
          target.origin === page.origin &&
          [`/${path[2]}/${path[3]}/`, `/${username}/${path[2]}/${path[3]}/`].includes(
            target.pathname,
          ) &&
          publishedAt >= submittedAt - 1000 &&
          publishedAt <= submittedAt + 300_000
        );
      },
    );
    if (timestamp)
      return {
        state: "published" as const,
        postUrl: `https://www.instagram.com/${path[2]}/${path[3]}/`,
        observedAt,
      };
  }
  return null;
}
