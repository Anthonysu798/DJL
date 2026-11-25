import "../../index.css";

import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { cleanup, render } from "vitest-browser-react";

import { EffortSlider } from "./effort-slider";

const LEVELS = [
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" },
  { id: "ultracode", label: "Ultracode" },
];

afterEach(async () => {
  await cleanup();
});

function Controlled(props: { onChange: (value: string) => void }) {
  const [value, setValue] = useState("medium");
  return (
    <div className="dark bg-background p-10 text-foreground">
      <EffortSlider
        levels={LEVELS}
        value={value}
        recommended="medium"
        onValueChange={(next) => {
          setValue(next);
          props.onChange(next);
        }}
      />
    </div>
  );
}

it("moves between levels with the keyboard and names the current one", async () => {
  const onChange = vi.fn();
  await render(<Controlled onChange={onChange} />);
  const slider = page.getByRole("slider", { name: "Effort" });
  await expect.element(slider).toHaveAttribute("aria-valuetext", "Medium");
  (slider.element() as HTMLElement).focus();
  await userEvent.keyboard("{ArrowRight}");
  expect(onChange).toHaveBeenLastCalledWith("high");
  await expect.element(slider).toHaveAttribute("aria-valuetext", "High");
  await userEvent.keyboard("{Home}");
  expect(onChange).toHaveBeenLastCalledWith("low");
});

it("lights the Ultracode trail only on the Ultracode stop", async () => {
  await render(<Controlled onChange={() => undefined} />);
  const slider = page.getByRole("slider", { name: "Effort" });
  (slider.element() as HTMLElement).focus();
  await userEvent.keyboard("{End}");
  await expect.element(slider).toHaveAttribute("aria-valuetext", "Ultracode");
  // The trail comes out once the thumb lands on the stop.
  await expect.poll(() => slider.element().hasAttribute("data-ultra")).toBe(true);
  await userEvent.keyboard("{ArrowLeft}");
  await expect.poll(() => slider.element().hasAttribute("data-ultra")).toBe(false);
});

it("shows translated text and explains effort on request", async () => {
  await render(
    <EffortSlider
      levels={LEVELS}
      defaultValue="low"
      strings={{ effort: "Aufwand", help: "Über Aufwand", note: "Mehr Aufwand, längeres Denken." }}
    />,
  );
  await expect.element(page.getByRole("slider", { name: "Aufwand" })).toBeVisible();
  await page.getByRole("button", { name: "Über Aufwand" }).click();
  await expect.element(page.getByText("Mehr Aufwand, längeres Denken.")).toBeVisible();
});

it("lights the top stop of a ladder without Ultracode when it is the chosen top level", async () => {
  await render(
    <div className="dark bg-background p-10 text-foreground">
      <EffortSlider
        levels={[
          { id: "low", label: "Low" },
          { id: "high", label: "High" },
          { id: "max", label: "Max" },
        ]}
        defaultValue="high"
        ultraLevel="max"
      />
    </div>,
  );
  const slider = page.getByRole("slider", { name: "Effort" });
  (slider.element() as HTMLElement).focus();
  await userEvent.keyboard("{End}");
  await expect.element(slider).toHaveAttribute("aria-valuetext", "Max");
  await expect.poll(() => slider.element().hasAttribute("data-ultra")).toBe(true);
});
