import "../../index.css";
import { useState } from "react";
import { expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import type { MultiPostAccount, MultiPostFile } from "@synara/contracts";
import { PostPreview } from "./PostPreview";

const account = (platformKey: string) =>
  ({
    id: platformKey,
    platformKey,
    label: `@${platformKey}`,
    status: "connected",
  }) as MultiPostAccount;
const photo = (name: string): MultiPostFile => ({
  name,
  type: "image/png",
  url: `Media/${name}`,
});

function Harness({ platformKey, files: start }: { platformKey: string; files: MultiPostFile[] }) {
  const [files, setFiles] = useState(start);
  return (
    <>
      <PostPreview
        threadId="t"
        text="Hello"
        files={files}
        accounts={[account(platformKey)]}
        capabilities={[]}
        onFocus={(url, focus) =>
          setFiles((old) => old.map((file) => (file.url === url ? { ...file, focus } : file)))
        }
      />
      <output data-testid="focus">{JSON.stringify(files.map((file) => file.focus ?? null))}</output>
    </>
  );
}
const focus = () => JSON.parse(page.getByTestId("focus").element().textContent!);
const shown = () => document.querySelector<HTMLImageElement>(".mp-preview-media img")!;

it("lets people move the square Instagram will show, starting from the middle", async () => {
  await render(<Harness platformKey="instagram" files={[photo("a.png")]} />);
  const frame = page.getByRole("group", { name: "Move the picture" });
  await expect.element(frame).toBeVisible();
  await expect.element(page.getByText(/DJL crops it to this shape/)).toBeVisible();
  expect(shown().style.objectPosition).toBe("50% 50%");
  (frame.element() as HTMLElement).focus();
  await userEvent.keyboard("{ArrowLeft}{ArrowLeft}{ArrowDown}");
  expect(focus()).toEqual([{ x: 0.3, y: 0.6 }]);
  expect(shown().style.objectPosition).toBe("30% 60%");
  await userEvent.keyboard("{ArrowLeft}{ArrowLeft}{ArrowLeft}{ArrowLeft}");
  expect(focus()[0].x).toBe(0);
});

it("moves each photo of a carousel on its own", async () => {
  await render(<Harness platformKey="instagram" files={[photo("a.png"), photo("b.png")]} />);
  await page.getByRole("button", { name: "Next photo" }).click();
  expect(shown().src).toContain("b.png");
  (page.getByRole("group", { name: "Move the picture" }).element() as HTMLElement).focus();
  await userEvent.keyboard("{ArrowRight}");
  expect(focus()).toEqual([null, { x: 0.6, y: 0.5 }]);
});

it("does not offer a crop where the platform keeps the whole picture", async () => {
  await render(<Harness platformKey="x" files={[photo("a.png")]} />);
  await expect.element(page.getByText(/Your file is not changed/)).toBeVisible();
  expect(page.getByRole("group", { name: "Move the picture" }).query()).toBeNull();
});
