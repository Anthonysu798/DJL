import "../../index.css";

import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { cleanup, render } from "vitest-browser-react";

import { DjlMascot } from "./DjlMascot";
import {
  HomeModeToggle,
  HomeSuggestions,
  HomeTopicChips,
  useHomeSuggestions,
  type HomeMode,
} from "./HomeStarter";

afterEach(async () => {
  await cleanup();
});

function Starter(props: {
  onPick: (prompt: string) => void;
  onPreview: (p: string | null) => void;
}) {
  const [mode, setMode] = useState<HomeMode>("work");
  const [topic, setTopic] = useState<string | null>(null);
  const suggestions = useHomeSuggestions(topic);
  return (
    <div className="p-8">
      <HomeModeToggle mode={mode} onChange={setMode} />
      <HomeTopicChips mode={mode} topic={topic} onTopicChange={setTopic} />
      {topic ? (
        <HomeSuggestions
          topic={topic}
          suggestions={suggestions}
          onPreview={props.onPreview}
          onPick={props.onPick}
        />
      ) : null}
    </div>
  );
}

it("opens a topic's suggestions, previews on hover and fills on click", async () => {
  const onPick = vi.fn();
  const onPreview = vi.fn();
  await render(<Starter onPick={onPick} onPreview={onPreview} />);
  await page.getByRole("button", { name: "Documents" }).click();
  await expect
    .element(page.getByRole("button", { name: "Documents" }))
    .toHaveAttribute("aria-pressed", "true");
  const suggestion = page.getByRole("button", { name: "Write a weekly report" });
  await suggestion.hover();
  expect(onPreview).toHaveBeenLastCalledWith(expect.stringContaining("weekly report"));
  await suggestion.click();
  expect(onPick).toHaveBeenCalledWith(expect.stringContaining("three short sections"));
});

it("switches between Work and Code topics", async () => {
  await render(<Starter onPick={() => undefined} onPreview={() => undefined} />);
  await expect.element(page.getByRole("button", { name: "Slides" })).toBeVisible();
  await page.getByRole("radio", { name: "Code" }).click();
  await expect
    .element(page.getByRole("radio", { name: "Code" }))
    .toHaveAttribute("aria-checked", "true");
  await expect.element(page.getByRole("button", { name: "Websites" })).toBeVisible();
  expect(page.getByRole("button", { name: "Slides" }).elements()).toHaveLength(0);
});

it("makes the mascot happy when clicked", async () => {
  await render(<DjlMascot label="Say hi to DJL" className="h-20 w-24" />);
  const mascot = page.getByRole("button", { name: "Say hi to DJL" });
  await mascot.click();
  await expect.element(mascot).toHaveAttribute("data-happy", "");
});
