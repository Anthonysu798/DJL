import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CopyReference } from "./CopyReference";

const original = Object.getOwnPropertyDescriptor(navigator, "clipboard");
const writeText = vi.fn<(value: string) => Promise<void>>();

beforeEach(() => {
  writeText.mockReset();
  writeText.mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
});
afterEach(() => {
  if (original) Object.defineProperty(navigator, "clipboard", original);
  else Reflect.deleteProperty(navigator, "clipboard");
});

describe("order reference copy", () => {
  it("copies the exact complete reference only after an explicit click", async () => {
    const value = "order-20261103-complete-reference";
    render(<CopyReference label="完整订单号" value={value} />);
    expect(writeText).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "复制完整订单号" }));
    expect(writeText).toHaveBeenCalledExactlyOnceWith(value);
    expect(await screen.findByRole("status")).toHaveTextContent("完整订单号已复制");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("blocks a duplicate click until the browser confirms the copy", async () => {
    let finish!: () => void;
    writeText.mockReturnValue(new Promise<void>((resolve) => (finish = resolve)));
    render(<CopyReference label="运单号" value="TRACK-123456789" />);
    const button = screen.getByRole("button", { name: "复制运单号" });
    fireEvent.click(button);
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("运单号已复制。")).not.toBeInTheDocument();
    await act(async () => finish());
    expect(button).toBeEnabled();
    expect(screen.getByRole("status")).toHaveTextContent("运单号已复制");
  });

  it("offers the exact selected read-only text when clipboard permission is refused", async () => {
    writeText.mockRejectedValue(new DOMException("Denied", "NotAllowedError"));
    render(<CopyReference label="运单号" value="TRACK-FULL-REFERENCE" />);
    fireEvent.click(screen.getByRole("button", { name: "复制运单号" }));
    const input = (await screen.findByRole("textbox", {
      name: "手动复制运单号",
    })) as HTMLInputElement;
    expect(input).toHaveValue("TRACK-FULL-REFERENCE");
    expect(input).toHaveAttribute("readonly");
    await waitFor(() => {
      expect(input).toHaveFocus();
      expect(input.selectionStart).toBe(0);
      expect(input.selectionEnd).toBe(input.value.length);
    });
    expect(screen.getByRole("status")).toHaveTextContent("请手动复制");
    expect(screen.queryByText("运单号已复制。")).not.toBeInTheDocument();
  });

  it("supports manual copy when the browser has no clipboard API", async () => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
    render(<CopyReference label="完整订单号" value="order-no-clipboard" />);
    fireEvent.click(screen.getByRole("button", { name: "复制完整订单号" }));
    expect(await screen.findByRole("textbox", { name: "手动复制完整订单号" })).toHaveValue(
      "order-no-clipboard",
    );
    expect(writeText).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("请手动复制");
  });

  it("does not show a late copy result for a replaced reference", async () => {
    let finish!: () => void;
    writeText.mockReturnValueOnce(new Promise<void>((resolve) => (finish = resolve)));
    const { rerender } = render(<CopyReference label="运单号" value="OLD-TRACKING" />);
    fireEvent.click(screen.getByRole("button", { name: "复制运单号" }));
    rerender(<CopyReference label="运单号" value="NEW-TRACKING" />);
    await act(async () => finish());
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "复制运单号" }));
    expect(await screen.findByRole("status")).toHaveTextContent("运单号已复制");
    expect(writeText).toHaveBeenLastCalledWith("NEW-TRACKING");
  });

  it("does not leak late failure feedback into a newly mounted account view", async () => {
    let fail!: (error: Error) => void;
    writeText.mockReturnValueOnce(new Promise<void>((_resolve, reject) => (fail = reject)));
    const previous = render(<CopyReference label="完整订单号" value="previous-account-order" />);
    fireEvent.click(screen.getByRole("button", { name: "复制完整订单号" }));
    previous.unmount();
    render(<CopyReference label="完整订单号" value="new-account-order" />);
    await act(async () => fail(new Error("Denied later")));
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(writeText).toHaveBeenCalledTimes(1);
  });
});
