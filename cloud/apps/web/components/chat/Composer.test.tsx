import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Composer } from "./Composer";
import { renderWithChat } from "./test-utils";

const file = (name: string, type: string, size?: number) => {
  const f = new File(["x".repeat(8)], name, { type });
  if (size !== undefined) Object.defineProperty(f, "size", { value: size });
  return f;
};

describe("Composer", () => {
  it("shows custom inline errors for unsupported and oversized files and uploads the rest", async () => {
    const user = userEvent.setup({ applyAccept: false });
    const { mock } = renderWithChat(
      <Composer running={false} onStop={() => {}} onSubmit={async () => ({ ok: true })} />,
    );
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    await user.upload(input, [
      file("virus.exe", "application/x-msdownload"),
      file("huge.pdf", "application/pdf", 26 * 1024 * 1024),
      file("notes.pdf", "application/pdf"),
    ]);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("virus.exe isn't supported");
    expect(alert).toHaveTextContent("huge.pdf is larger than 25 MB.");
    expect(document.querySelector("form")).toHaveAttribute("novalidate");
    await waitFor(() => expect(screen.getByText("notes.pdf")).toBeInTheDocument());
    await waitFor(() => expect(mock.requests.some((r) => r.path.endsWith("/complete"))).toBe(true));
  });

  it("resends an unchanged draft with the same clientMessageId after a failure", async () => {
    const user = userEvent.setup();
    const onSubmit = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, error: "Your message wasn't sent." })
      .mockResolvedValueOnce({ ok: true });
    renderWithChat(<Composer running={false} onStop={() => {}} onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText("Message DJL"), "Hello{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent("Your message wasn't sent.");
    expect(screen.getByLabelText("Message DJL")).toHaveValue("Hello"); // draft restored

    await user.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
    const [first, second] = onSubmit.mock.calls.map((c) => c[0].clientMessageId);
    expect(second).toBe(first);
    expect(screen.getByLabelText("Message DJL")).toHaveValue("");
  });

  it("uses a new clientMessageId once the draft changes", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue({ ok: false, error: null });
    renderWithChat(<Composer running={false} onStop={() => {}} onSubmit={onSubmit} />);
    const box = screen.getByLabelText("Message DJL");
    await user.type(box, "Hello{Enter}");
    await waitFor(() => expect(box).toHaveValue("Hello"));
    await user.type(box, " there{Enter}");
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
    const [first, second] = onSubmit.mock.calls.map((c) => c[0].clientMessageId);
    expect(second).not.toBe(first);
  });

  it("shows a stop button while a reply is running", async () => {
    const user = userEvent.setup();
    const onStop = vi.fn();
    renderWithChat(<Composer running onStop={onStop} onSubmit={async () => ({ ok: true })} />);
    await user.click(screen.getByRole("button", { name: "Stop" }));
    expect(onStop).toHaveBeenCalled();
  });
});
