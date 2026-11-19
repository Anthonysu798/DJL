import "../../index.css";
import { expect, it } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import ChatMarkdown from "../ChatMarkdown";
it("navigates an agent's scoped human-authorization link in the same window", async () => {
  const previous = window.location.href;
  const target = "#/social/qa-chat?multipostView=authorizations&workflowId=qa-workflow";
  const screen = render(
    <ChatMarkdown
      cwd={undefined}
      text={`[Review local workflow](${target})`}
      isStreaming={false}
    />,
  );
  try {
    const link = page.getByRole("link", { name: "Review local workflow" });
    await expect.element(link).not.toHaveAttribute("target", "_blank");
    await link.click();
    await expect.poll(() => window.location.hash).toBe(target);
  } finally {
    window.history.replaceState(null, "", previous);
    await (await screen).unmount();
  }
});
