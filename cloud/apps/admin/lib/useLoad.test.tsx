import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { useLoad } from "./useLoad";
afterEach(cleanup);
it("does not replace the latest filter result with a slower previous request", async () => {
  let old!: (value: string) => void;
  const previous = new Promise<string>((resolve) => {
    old = resolve;
  });
  const { result, rerender } = renderHook(
    ({ filter }) =>
      useLoad(() => (filter === "old" ? previous : Promise.resolve("current")), [filter]),
    { initialProps: { filter: "old" } },
  );
  rerender({ filter: "new" });
  await waitFor(() => expect(result.current.data).toBe("current"));
  await act(async () => old("stale"));
  expect(result.current.data).toBe("current");
});
