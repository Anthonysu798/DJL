/**
 * Canned content for the mock API: replies, task steps, and generated images.
 * Deliberately plain; it only has to exercise every part type the UI renders.
 */

export function chatReply(prompt: string, variant: number): string {
  const topic = prompt.trim().replace(/\s+/g, " ").slice(0, 60) || "your question";
  const variants = [
    `Here's a quick take on **${topic}**.\n\n` +
      "1. **Start small.** Pick the one outcome that matters most and define what done looks like.\n" +
      "2. **Measure it.** Decide how you'll know it worked before you begin.\n" +
      "3. **Iterate.** Ship a first version, then refine with real feedback.\n\n" +
      "A tiny example in TypeScript:\n\n" +
      "```ts\nexport function progress(done: number, total: number): string {\n" +
      "  const pct = total === 0 ? 0 : Math.round((done / total) * 100);\n" +
      "  return `${pct}% complete`;\n}\n```\n\n" +
      "Want me to go deeper on any of these steps?",
    `Another way to look at **${topic}**:\n\n` +
      "| Option | Effort | Payoff |\n| --- | --- | --- |\n| Quick fix | Low | Short-term |\n| Proper redesign | High | Long-term |\n\n" +
      "> Pick the quick fix when you need results this week; plan the redesign in parallel.\n\n" +
      "Let me know which constraints matter most and I'll tailor this.",
    `Short answer on **${topic}**: it depends on scale.\n\n` +
      "- For a handful of items, keep it manual.\n- Past a few hundred, automate with a script:\n\n" +
      '```python\nimport csv\n\nwith open("items.csv") as f:\n    rows = list(csv.DictReader(f))\nprint(len(rows), "items")\n```',
  ];
  return variants[variant % variants.length]!;
}

export function taskSummary(prompt: string): string {
  const topic = prompt.trim().slice(0, 60) || "the task";
  return (
    `I finished researching **${topic}**.\n\n` +
    "**What I found**\n\n" +
    "- Three reliable sources agree on the main points.\n" +
    "- The numbers check out: the script above reproduces the totals.\n\n" +
    "**Next steps**\n\n1. Review the sources linked in the steps.\n2. Tell me if you want a shorter summary or a table."
  );
}

export const wantsImage = (prompt: string) =>
  /\b(draw|image|picture|illustration|logo|poster|edit)\b|画|图/i.test(prompt);

/** A soft abstract illustration as an SVG data URL; `seed` varies the palette. */
export function generatedImageDataUrl(seed: number, label: string): string {
  const hue = (seed * 67) % 360;
  const safe = label.replace(/[<>&"']/g, "").slice(0, 40);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
<defs>
<linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="hsl(${hue} 70% 62%)"/><stop offset="1" stop-color="hsl(${(hue + 60) % 360} 65% 38%)"/>
</linearGradient>
<radialGradient id="s" cx="0.3" cy="0.3" r="0.6"><stop offset="0" stop-color="#fff" stop-opacity="0.55"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
</defs>
<rect width="1024" height="1024" fill="url(#g)"/>
<circle cx="700" cy="360" r="190" fill="hsl(${(hue + 30) % 360} 80% 80%)" opacity="0.85"/>
<path d="M0 760 C 220 640 420 820 640 720 S 900 620 1024 700 L1024 1024 L0 1024 Z" fill="hsl(${(hue + 200) % 360} 45% 22%)" opacity="0.8"/>
<path d="M0 850 C 260 760 520 900 760 820 S 960 780 1024 800 L1024 1024 L0 1024 Z" fill="hsl(${(hue + 210) % 360} 40% 14%)" opacity="0.9"/>
<rect width="1024" height="1024" fill="url(#s)"/>
<text x="56" y="980" font-family="system-ui, sans-serif" font-size="28" fill="#fff" opacity="0.75">${safe}</text>
</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
