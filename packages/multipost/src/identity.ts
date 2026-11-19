/** Closure-free: the desktop serializes this into its dedicated platform page. */
export function resolveDomIdentity(platformKey: string, doc: Document, pageUrl: string) {
  const domains: Record<string, string[]> = {
    instagram: ["instagram.com"],
    linkedin: ["linkedin.com"],
    threads: ["threads.com", "threads.net"],
    youtube: ["youtube.com"],
  };
  const supported = domains[platformKey];
  if (!supported) return null;
  let location: URL;
  try {
    location = new URL(pageUrl);
  } catch {
    return null;
  }
  if (
    location.protocol !== "https:" ||
    !supported.some(
      (domain) => location.hostname === domain || location.hostname.endsWith("." + domain),
    )
  )
    return null;
  const result = (name: string) => ({
    provider: platformKey,
    accountId: name,
    username: name,
    verifiedAt: new Date().toISOString(),
  });
  if (platformKey === "instagram") {
    // oxlint-disable-next-line unicorn/consistent-function-scoping -- Keep helpers inside the function serialized into the platform page.
    const url = (anchor: HTMLAnchorElement) => {
      try {
        return new URL(anchor.href);
      } catch {
        return null;
      }
    };
    const anchors = Array.from(doc.querySelectorAll<HTMLAnchorElement>("a[href]"));
    const inbox = anchors.find((anchor) => {
      const target = url(anchor);
      return (
        target &&
        (target.hostname === "instagram.com" || target.hostname.endsWith(".instagram.com")) &&
        target.pathname.startsWith("/direct/")
      );
    });
    let navigation = inbox?.parentElement ?? null;
    while (navigation && navigation !== doc.body && navigation !== doc.documentElement) {
      const links = Array.from(navigation.querySelectorAll<HTMLAnchorElement>("a[href]"));
      if (!links.some((anchor) => url(anchor)?.pathname === "/reels/")) {
        navigation = navigation.parentElement;
        continue;
      }
      // Stop at the nearest signed-in navigation group. Never widen into a feed.
      if (links.length > 20 || navigation.querySelector("main,article,[role=main]")) return null;
      const reserved = new Set([
        "accounts",
        "direct",
        "reels",
        "reel",
        "explore",
        "p",
        "stories",
        "notifications",
        "settings",
        "about",
        "legal",
      ]);
      const candidates = new Set<string>();
      for (const anchor of links) {
        const target = url(anchor);
        if (
          !target ||
          target.protocol !== "https:" ||
          !(target.hostname === "instagram.com" || target.hostname.endsWith(".instagram.com"))
        )
          return null;
        const parts = target.pathname.split("/").filter(Boolean);
        if (parts[0] === "p" || parts[0] === "reel" || parts[0] === "stories") return null;
        const name = parts[0];
        if (
          parts.length !== 1 ||
          !name ||
          reserved.has(name) ||
          !/^[A-Za-z0-9._]{1,30}$/.test(name)
        )
          continue;
        const imageLabel = anchor.querySelector("img[alt]")?.getAttribute("alt") ?? "";
        if (imageLabel.toLowerCase().startsWith(name.toLowerCase())) candidates.add(name);
      }
      return candidates.size === 1 ? result([...candidates][0]!) : null;
    }
    return null;
  }
  const selectors: Record<string, string> = {
    linkedin: 'a[href*="/in/"][data-control-name*="identity"]',
    threads: 'a[aria-label="Profile"]',
    youtube: 'meta[itemprop="channelId"]',
  };
  const own = doc.querySelector(selectors[platformKey]!);
  const value = own?.getAttribute("content") ?? own?.getAttribute("href");
  if (!value) return null;
  const name = value
    .replace(/^https?:\/\/[^/]+/, "")
    .split("/")
    .findLast(Boolean);
  return name ? result(name) : null;
}
