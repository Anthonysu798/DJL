import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { expect, it, vi } from "vitest";

import CodeSlots from "./CodeSlots";

function Example({ initial = "" }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <CodeSlots
      id="test-code"
      length={8}
      value={value}
      onChange={setValue}
      ariaLabel="Device code"
    />
  );
}

it("preserves all eight letters and numbers from the supplied device code", () => {
  render(<Example initial="DEMO1234" />);
  expect(screen.getByRole("textbox", { name: "Device code" })).toHaveValue("DEMO1234");
});

it("supports full-code paste, select-all replacement and backspace", async () => {
  const user = userEvent.setup();
  render(<Example />);
  const input = screen.getByRole("textbox", { name: "Device code" });
  await user.click(input);
  await user.paste("abcd-1234");
  expect(input).toHaveValue("ABCD1234");
  await user.keyboard("{Control>}a{/Control}");
  await user.paste("next5678");
  expect(input).toHaveValue("NEXT5678");
  await user.keyboard("{Backspace}");
  expect(input).toHaveValue("NEXT567");
});

it("retains a rejected code and exposes the error without calling onChange", () => {
  const onChange = vi.fn();
  render(<CodeSlots value="FAIL1234" onChange={onChange} invalid ariaLabel="Device code" />);
  expect(screen.getByRole("textbox")).toHaveValue("FAIL1234");
  expect(screen.getByRole("textbox")).toHaveAttribute("aria-invalid", "true");
  expect(onChange).not.toHaveBeenCalled();
});

it("normalizes edits without permitting overflow", () => {
  const onChange = vi.fn();
  render(<CodeSlots value="" onChange={onChange} ariaLabel="Device code" />);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "abc!d 123456" } });
  expect(onChange).toHaveBeenCalledWith("ABCD1234");
});
