import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { api } = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("@/lib/api", () => ({ api }));

import { CanadianAddressLookup } from "./CanadianAddressLookup";

const path = "/v1/commerce/address-lookup";
const older = { placeId: "fixture-old", label: "50 Old Fixture Street, Toronto, ON" };
const current = { placeId: "fixture-current", label: "50 Fixture Avenue, Vancouver, BC" };
const newer = { placeId: "fixture-newer", label: "77 Synthetic Road, Surrey, BC" };
const address = {
  line1: "50 Fixture Avenue",
  line2: "Unit 3",
  city: "Vancouver",
  province: "BC",
  postalCode: "V6B 1A1",
  country: "CA",
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

beforeEach(() => {
  api.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
});

async function tick(milliseconds = 300) {
  await act(async () => {
    vi.advanceTimersByTime(milliseconds);
  });
}

async function renderEnabled() {
  vi.useFakeTimers();
  api.mockResolvedValueOnce({ enabled: true });
  const view = render(<CanadianAddressLookup />);
  await act(async () => {});
  return view;
}

function begin() {
  fireEvent.click(screen.getByRole("button", { name: "查找加拿大地址" }));
  return screen.getByRole("textbox", { name: "输入加拿大地址" });
}

function type(input: HTMLElement, value: string) {
  fireEvent.change(input, { target: { value } });
}

describe("opt-in Canada address lookup", () => {
  it.each([null, {}, { enabled: false }, { enabled: "true" }])(
    "does not show a lookup or fake fallback for a nonconfirmed capability: %o",
    async (reply) => {
      api.mockResolvedValueOnce(reply);
      render(<CanadianAddressLookup />);
      await act(async () => {});
      expect(screen.queryByRole("region", { name: "加拿大地址查找" })).not.toBeInTheDocument();
      expect(api).toHaveBeenCalledExactlyOnceWith(path, {
        method: "GET",
        cache: "no-store",
        signal: expect.any(AbortSignal),
      });
    },
  );

  it("hides the feature for an unavailable endpoint without attempting a query", async () => {
    api.mockRejectedValueOnce(Object.assign(new Error("not found"), { status: 404 }));
    render(<CanadianAddressLookup />);
    await act(async () => {});
    expect(screen.queryByRole("region", { name: "加拿大地址查找" })).not.toBeInTheDocument();
    expect(api).toHaveBeenCalledOnce();
  });

  it("accepts 50 after opt-in, attributes suggestions, and fills a keyboard-selected Canadian address", async () => {
    await renderEnabled();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "查找加拿大地址" })).toHaveAccessibleDescription(
      /Google Maps/,
    );
    expect(api).toHaveBeenCalledOnce();
    const input = begin();
    expect(input).toHaveFocus();
    type(input, "5");
    await tick();
    expect(api).toHaveBeenCalledOnce();

    api.mockResolvedValueOnce({ suggestions: [current] }).mockResolvedValueOnce({ address });
    type(input, "50");
    await tick(299);
    expect(api).toHaveBeenCalledOnce();
    await tick(1);
    const post = api.mock.calls[1]?.[1];
    const sessionToken = post.json.sessionToken;
    expect(sessionToken).toMatch(uuid);
    expect(api.mock.calls[1]).toEqual([
      path,
      { method: "POST", json: { query: "50", sessionToken }, signal: expect.any(AbortSignal) },
    ]);
    const choices = within(screen.getByRole("group", { name: "地址建议" }));
    expect(choices.getByText("Google Maps", { exact: true })).toHaveAttribute("translate", "no");
    const choice = choices.getByRole("button", { name: current.label });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(choice).toHaveFocus();
    vi.useRealTimers();
    const user = userEvent.setup();
    await act(async () => user.keyboard("{Enter}"));
    expect(api.mock.calls[2]).toEqual([
      path,
      {
        method: "POST",
        json: { placeId: current.placeId, sessionToken },
        signal: expect.any(AbortSignal),
      },
    ]);
    const preview = within(screen.getByRole("region", { name: "所选加拿大地址" }));
    expect(preview.getByRole("textbox", { name: "街道地址" })).toHaveValue(address.line1);
    expect(preview.getByRole("textbox", { name: "单元号" })).toHaveValue(address.line2);
    expect(preview.getByRole("textbox", { name: "城市" })).toHaveValue(address.city);
    expect(preview.getByRole("textbox", { name: "省／地区" })).toHaveValue(address.province);
    expect(preview.getByRole("textbox", { name: "邮政编码" })).toHaveValue(address.postalCode);
    expect(preview.getByRole("status")).toHaveTextContent("没有保存或下单");
    expect(preview.getByText("Google Maps", { exact: true })).toHaveAttribute("translate", "no");
  });

  it("ignores stale query and detail replies, reuses a suggestion token, then starts a new one after selection", async () => {
    await renderEnabled();
    const input = begin();
    let finishQuery!: (reply: unknown) => void;
    let finishSelection!: (reply: unknown) => void;
    api
      .mockReturnValueOnce(
        new Promise((resolve) => {
          finishQuery = resolve;
        }),
      )
      .mockResolvedValueOnce({ suggestions: [current] })
      .mockReturnValueOnce(
        new Promise((resolve) => {
          finishSelection = resolve;
        }),
      )
      .mockResolvedValueOnce({ suggestions: [newer] });
    type(input, "50");
    await tick();
    const first = api.mock.calls[1]?.[1];
    type(input, "500");
    expect(first.signal.aborted).toBe(true);
    await tick();
    const second = api.mock.calls[2]?.[1];
    expect(second.json.sessionToken).toBe(first.json.sessionToken);
    await act(async () => finishQuery({ suggestions: [older] }));
    expect(screen.queryByRole("button", { name: older.label })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: current.label }));
    const selection = api.mock.calls[3]?.[1];
    expect(selection.json.sessionToken).toBe(first.json.sessionToken);
    type(input, "77");
    expect(selection.signal.aborted).toBe(true);
    await tick();
    const fourth = api.mock.calls[4]?.[1];
    expect(fourth.json).toMatchObject({ query: "77", sessionToken: expect.stringMatching(uuid) });
    expect(fourth.json.sessionToken).not.toBe(first.json.sessionToken);
    await act(async () => finishSelection({ address }));
    expect(screen.queryByRole("region", { name: "所选加拿大地址" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: newer.label })).toBeInTheDocument();
  });

  it("provides empty/error alternatives and does not display an invalid non-Canadian result", async () => {
    await renderEnabled();
    api
      .mockResolvedValueOnce({ suggestions: [] })
      .mockResolvedValueOnce({ suggestions: [current] })
      .mockResolvedValueOnce({ address: { ...address, country: "US" } });
    const input = begin();
    type(input, "50");
    await tick();
    expect(screen.getByRole("status")).toHaveTextContent("没有合适建议");
    type(input, "50 Fixture");
    await tick();
    fireEvent.click(screen.getByRole("button", { name: current.label }));
    await act(async () => {});
    expect(screen.getByRole("alert")).toHaveTextContent("自行记录地址");
    expect(screen.queryByRole("region", { name: "所选加拿大地址" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重试地址查找" })).toBeInTheDocument();
  });

  it("clears without saving and aborts a pending query on unmount", async () => {
    const view = await renderEnabled();
    const input = begin();
    type(input, "50");
    fireEvent.click(screen.getByRole("button", { name: "清除并结束查找" }));
    await tick();
    expect(api).toHaveBeenCalledOnce();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    let finish!: (reply: unknown) => void;
    api.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    type(begin(), "77");
    await tick();
    const signal = api.mock.calls[1]?.[1]?.signal;
    view.unmount();
    expect(signal?.aborted).toBe(true);
    await act(async () => finish({ suggestions: [newer] }));
    expect(screen.queryByRole("button", { name: newer.label })).not.toBeInTheDocument();
  });
});
