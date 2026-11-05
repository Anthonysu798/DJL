import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import { FieldError } from "./field";

afterEach(cleanup);

it("keeps each unique error's element when errors are reordered", () => {
  const { rerender } = render(
    <FieldError errors={[{ message: "First error" }, { message: "Second error" }]} />,
  );
  const first = screen.getByText("First error");
  const second = screen.getByText("Second error");

  rerender(<FieldError errors={[{ message: "Second error" }, { message: "First error" }]} />);

  expect(screen.getAllByRole("listitem")).toEqual([second, first]);
  expect(screen.getByText("First error")).toBe(first);
  expect(screen.getByText("Second error")).toBe(second);
});

it("deduplicates messages and does not render empty errors", () => {
  render(
    <FieldError
      errors={[
        { message: "First error" },
        undefined,
        { message: "First error" },
        { message: "" },
        { message: "Second error" },
      ]}
    />,
  );

  expect(screen.getAllByRole("listitem").map((item) => item.textContent)).toEqual([
    "First error",
    "Second error",
  ]);
});
