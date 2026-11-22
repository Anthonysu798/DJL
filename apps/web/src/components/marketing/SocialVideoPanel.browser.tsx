import { describe, it, expect, vi } from "vitest";
import { render } from "vitest-browser-react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createCampaign } from "@djl/contracts";
import { SocialVideoPanel } from "./SocialVideoPanel";
import "../../index.css";
const requests = vi.hoisted(() => ({ agent: vi.fn(), command: vi.fn() }));
vi.mock("./agentClient", () => ({ agentCommand: requests.agent }));
vi.mock("./client", async (original) => ({
  ...(await original<typeof import("./client")>()),
  command: requests.command,
}));
const video = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Source.mp4",
  mime: "video/mp4",
  bytes: 1000,
  createdAt: new Date().toISOString(),
  duration: 6,
};
describe("social video panel", () => {
  it("renders a bounded clip and selects only that output using the returned campaign version", async () => {
    const campaign = {
      ...createCampaign("Clip draft"),
      threadId: "video-chat",
      assetIds: [video.id],
    };
    let job: Record<string, unknown> | undefined;
    requests.agent.mockImplementation(async (_thread, tool, args) => {
      if (tool === "djl_repurpose_video" && args.action === "render")
        return (job = {
          id: "job-one",
          status: "complete",
          campaignId: campaign.id,
          campaignVersion: 7,
          sourceAssetId: video.id,
          clips: [
            {
              assetId: "clip-one",
              coverAssetId: "cover-one",
              start: 1,
              end: 3,
              crop: "original",
              duration: 2,
              width: 320,
              height: 240,
            },
          ],
        });
      return { jobs: job ? [job] : [], transcripts: [] };
    });
    requests.command.mockResolvedValue({
      value: { ...campaign, assetIds: ["clip-one"] },
      version: 8,
    });
    const screen = await render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <SocialVideoPanel
          threadId="video-chat"
          campaign={{ value: campaign, version: 3 }}
          assets={[video]}
        />
      </QueryClientProvider>,
    );
    await screen.getByRole("spinbutton", { name: "Start (seconds)", exact: true }).fill("1");
    await screen.getByRole("spinbutton", { name: "End (seconds)", exact: true }).fill("3");
    await screen.getByRole("button", { name: "Render clip", exact: true }).click();
    await expect
      .element(screen.getByRole("button", { name: "Use clip", exact: true }))
      .toBeVisible();
    expect(requests.agent).toHaveBeenCalledWith(
      "video-chat",
      "djl_repurpose_video",
      expect.objectContaining({
        action: "render",
        version: 3,
        assetId: video.id,
        clips: [{ start: 1, end: 3, crop: "original" }],
      }),
    );
    await screen.getByRole("button", { name: "Use clip", exact: true }).click();
    expect(requests.command).toHaveBeenCalledWith({
      action: "update",
      id: campaign.id,
      version: 7,
      patch: { assetIds: ["clip-one"] },
    });
    await expect
      .element(screen.getByText("Clip selected for this draft. Review before publishing."))
      .toBeVisible();
    await screen.unmount();
  });
  it("shows an unavailable transcription service without adding invented subtitles", async () => {
    requests.agent.mockImplementation(async (_thread, tool) =>
      tool === "djl_transcribe_video"
        ? {
            status: "unavailable",
            nextStep: "Connect and sign in to the Codex provider.",
            limits: "Chunk-level timing only.",
          }
        : { jobs: [], transcripts: [] },
    );
    const campaign = { ...createCampaign("Speech"), threadId: "speech-chat", assetIds: [video.id] };
    const screen = await render(
      <QueryClientProvider client={new QueryClient()}>
        <SocialVideoPanel
          threadId="speech-chat"
          campaign={{ value: campaign, version: 1 }}
          assets={[video]}
        />
      </QueryClientProvider>,
    );
    await screen.getByText("Subtitles · optional", { exact: true }).click();
    await screen.getByRole("button", { name: "Transcribe selected range", exact: true }).click();
    await expect
      .element(screen.getByText("Connect and sign in to the Codex provider."))
      .toBeVisible();
    await expect
      .element(screen.getByRole("textbox", { name: "Subtitle text 1" }))
      .not.toBeInTheDocument();
    await screen.unmount();
  });
  it("imports supplied timed text and sends the manual crop position without transcript claims", async () => {
    requests.agent.mockImplementation(async (_thread, _tool, args) => {
      if (args.action === "render") throw new Error("Test stops before export");
      return { jobs: [], transcripts: [] };
    });
    const campaign = {
      ...createCampaign("Imported captions"),
      threadId: "import-chat",
      assetIds: [video.id],
    };
    const screen = await render(
      <QueryClientProvider client={new QueryClient()}>
        <SocialVideoPanel
          threadId="import-chat"
          campaign={{ value: campaign, version: 1 }}
          assets={[video]}
        />
      </QueryClientProvider>,
    );
    await screen.getByText("Subtitles · optional", { exact: true }).click();
    const transfer = new DataTransfer();
    transfer.items.add(
      new File(["1\n00:00:01,000 --> 00:00:02,000\nWords supplied by user"], "captions.srt", {
        type: "text/plain",
      }),
    );
    const picker = screen.getByLabelText("Import SRT or VTT").element() as HTMLInputElement;
    picker.files = transfer.files;
    picker.dispatchEvent(new Event("change", { bubbles: true }));
    await expect
      .element(screen.getByRole("textbox", { name: "Subtitle text 1" }))
      .toHaveValue("Words supplied by user");
    await screen.getByRole("combobox", { name: "Frame", exact: true }).click();
    await screen.getByRole("option", { name: "Vertical · 9:16", exact: true }).click();
    const slider = screen
      .getByRole("slider", { name: "Horizontal crop position" })
      .element() as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(slider, "0.8");
    slider.dispatchEvent(new Event("input", { bubbles: true }));
    await screen.getByRole("button", { name: "Render clip", exact: true }).click();
    expect(requests.agent).toHaveBeenCalledWith(
      "import-chat",
      "djl_repurpose_video",
      expect.objectContaining({
        action: "render",
        subtitleProvenance: "user-provided",
        clips: [
          expect.objectContaining({
            crop: "vertical",
            focalPoint: { x: 0.8, y: 0.5 },
            subtitles: [{ start: 1, end: 2, text: "Words supplied by user" }],
          }),
        ],
      }),
    );
    await screen.unmount();
  });
  it("marks edited real transcripts as supplied subtitles", async () => {
    requests.agent.mockImplementation(async (_thread, tool, args) => {
      if (tool === "djl_transcribe_video")
        return {
          status: "complete",
          transcript: {
            id: "transcript-real",
            segments: [{ start: 0, end: 2, text: "Actual provider response" }],
          },
        };
      if (args.action === "render") throw new Error("Test stops before export");
      return { jobs: [], transcripts: [] };
    });
    const campaign = {
      ...createCampaign("Transcript editing"),
      threadId: "edit-chat",
      assetIds: [video.id],
    };
    const screen = await render(
      <QueryClientProvider client={new QueryClient()}>
        <SocialVideoPanel
          threadId="edit-chat"
          campaign={{ value: campaign, version: 1 }}
          assets={[video]}
        />
      </QueryClientProvider>,
    );
    await screen.getByText("Subtitles · optional", { exact: true }).click();
    await screen.getByRole("button", { name: "Transcribe selected range", exact: true }).click();
    await screen.getByRole("textbox", { name: "Subtitle text 1" }).fill("Reviewed words");
    await screen.getByRole("button", { name: "Render clip", exact: true }).click();
    expect(requests.agent).toHaveBeenCalledWith(
      "edit-chat",
      "djl_repurpose_video",
      expect.objectContaining({ action: "render", subtitleProvenance: "user-provided" }),
    );
    const call = requests.agent.mock.calls.findLast(
      ([_thread, _tool, args]) => args.action === "render",
    );
    expect(call?.[2]).not.toHaveProperty("transcriptId");
    await screen.unmount();
  });
});
