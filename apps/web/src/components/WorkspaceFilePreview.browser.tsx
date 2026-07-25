// Browser regression coverage for native Work document rendering and text fallback.

import "../index.css";

import { DocumentArtifactId, ThreadId } from "@synara/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "vitest-browser-react";

import { WorkspaceFilePreview } from "./WorkspaceFilePreview";

const mocks = vi.hoisted(() => ({
  cancelDocumentRender: vi.fn(),
  getDocumentRender: vi.fn(),
  install: vi.fn(),
  openInEditor: vi.fn(),
  previewDocument: vi.fn(),
  readFile: vi.fn(),
  rendererStatus: vi.fn(),
  repair: vi.fn(),
  requestDocumentRender: vi.fn(),
  uninstall: vi.fn(),
}));

vi.mock("../nativeApi", () => {
  const api = {
    projects: { readFile: mocks.readFile },
    shell: { openInEditor: mocks.openInEditor },
    work: {
      previewDocument: mocks.previewDocument,
      requestDocumentRender: mocks.requestDocumentRender,
      getDocumentRender: mocks.getDocumentRender,
      cancelDocumentRender: mocks.cancelDocumentRender,
      documentRenderer: {
        status: mocks.rendererStatus,
        install: mocks.install,
        repair: mocks.repair,
        uninstall: mocks.uninstall,
        onEvent: () => () => undefined,
      },
    },
  };
  return { ensureNativeApi: () => api, readNativeApi: () => api };
});

vi.mock("./PdfFilePreview", () => ({
  PdfFilePreview: (props: { documentType?: string; previewUrl?: string }) => (
    <div data-testid="native-pages" data-preview-url={props.previewUrl}>
      Rendered {props.documentType} pages
    </div>
  ),
}));

vi.mock("./PresentationFilePreview", () => ({
  PresentationFilePreview: (props: { previewUrl: string }) => (
    <div data-testid="native-slides" data-preview-url={props.previewUrl}>
      Rendered PPTX slides with filmstrip
    </div>
  ),
}));

function artifact(name: string) {
  return {
    artifact: {
      id: DocumentArtifactId.makeUnsafe("artifact-preview-1"),
      originalName: name,
      extractionMethod: "native" as const,
      warnings: [],
      blocks: [
        {
          id: "block-1",
          kind: "text" as const,
          text: "Readable document content",
          locator: { paragraph: 1 },
          confidence: 1,
        },
      ],
      engineVersion: "djl-native-test",
      createdAt: "2026-07-13T00:00:00.000Z",
    },
  };
}

function readyRender(sourceType: "docx" | "pptx") {
  return {
    state: "ready" as const,
    preview: {
      renderId: "render-1",
      originalName: sourceType === "docx" ? "essay-v1.docx" : "deck-v1.pptx",
      sourceType,
      presentationMode: sourceType === "pptx" ? ("slides" as const) : ("document" as const),
      pageCount: 2,
      byteSize: 1_024,
      previewUrl: "/api/work/document-previews/render-1",
      previewGrant: "opaque-grant",
      grantExpiresAt: "2026-07-14T12:00:00.000Z",
      rendererVersion: "libreoffice-test",
      warnings: [],
    },
  };
}

function queryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

describe("WorkspaceFilePreview native Office viewer", () => {
  afterEach(async () => {
    await cleanup();
    for (const mock of Object.values(mocks)) mock.mockReset();
  });

  it("renders DOCX pages through the render RPC without invoking the text reader", async () => {
    mocks.rendererStatus.mockResolvedValue({
      state: "ready",
      installAvailable: false,
      version: "test",
      rendererVersion: "libreoffice-test",
      detail: null,
    });
    mocks.requestDocumentRender.mockResolvedValue({ renderId: "render-1", state: "ready" });
    mocks.getDocumentRender.mockResolvedValue(readyRender("docx"));
    mocks.previewDocument.mockResolvedValue(artifact("essay-v1.docx"));

    await render(
      <QueryClientProvider client={queryClient()}>
        <div className="h-[700px] w-[800px]">
          <WorkspaceFilePreview
            threadId={ThreadId.makeUnsafe("thread-1")}
            workspaceRoot="/tmp/DJL task"
            filePath="Deliverables/essay-v1.docx"
          />
        </div>
      </QueryClientProvider>,
    );

    await expect.element(page.getByText("Rendered DOCX pages")).toBeInTheDocument();
    expect(mocks.requestDocumentRender).toHaveBeenCalledWith({
      threadId: "thread-1",
      path: "Deliverables/essay-v1.docx",
    });
    expect(mocks.getDocumentRender).toHaveBeenCalledWith({
      threadId: "thread-1",
      renderId: "render-1",
    });
    expect(mocks.previewDocument).not.toHaveBeenCalled();
    expect(mocks.readFile).not.toHaveBeenCalled();

    await page.getByRole("button", { name: "Open", exact: true }).click();
    expect(mocks.openInEditor).toHaveBeenCalledWith(
      "/tmp/DJL task/Deliverables/essay-v1.docx",
      "system-default",
    );
  });

  it("renders PPTX through the presentation viewer path", async () => {
    mocks.rendererStatus.mockResolvedValue({
      state: "ready",
      installAvailable: false,
      version: "test",
      rendererVersion: "libreoffice-test",
      detail: null,
    });
    mocks.requestDocumentRender.mockResolvedValue({ renderId: "render-1", state: "ready" });
    mocks.getDocumentRender.mockResolvedValue(readyRender("pptx"));

    await render(
      <QueryClientProvider client={queryClient()}>
        <div className="h-[700px] w-[800px]">
          <WorkspaceFilePreview
            threadId={ThreadId.makeUnsafe("thread-1")}
            workspaceRoot="/tmp/DJL task"
            filePath="Deliverables/deck-v1.pptx"
          />
        </div>
      </QueryClientProvider>,
    );

    await expect.element(page.getByText("Rendered PPTX slides with filmstrip")).toBeInTheDocument();
    expect(mocks.readFile).not.toHaveBeenCalled();
  });

  it("offers local installation and readable text when the renderer is missing", async () => {
    mocks.rendererStatus.mockResolvedValue({
      state: "not_installed",
      installAvailable: true,
      version: null,
      rendererVersion: null,
      downloadSizeBytes: 200_000_000,
      detail: "Install the local document viewer.",
    });
    mocks.previewDocument.mockResolvedValue(artifact("essay-v1.docx"));

    await render(
      <QueryClientProvider client={queryClient()}>
        <div className="h-[700px] w-[800px]">
          <WorkspaceFilePreview
            threadId={ThreadId.makeUnsafe("thread-1")}
            workspaceRoot="/tmp/DJL task"
            filePath="Deliverables/essay-v1.docx"
          />
        </div>
      </QueryClientProvider>,
    );

    await expect.element(page.getByText("Install document viewer")).toBeInTheDocument();
    await page.getByRole("button", { name: "Readable text" }).click();
    await expect.element(page.getByText("Readable document content")).toBeInTheDocument();
    expect(mocks.readFile).not.toHaveBeenCalled();
  });

  it("continues using the text reader for ordinary workspace files", async () => {
    mocks.readFile.mockResolvedValue({
      relativePath: "notes.txt",
      contents: "Plain workspace notes",
      truncated: false,
    });

    await render(
      <QueryClientProvider client={queryClient()}>
        <div className="h-[700px] w-[800px]">
          <WorkspaceFilePreview
            threadId={ThreadId.makeUnsafe("thread-1")}
            workspaceRoot="/tmp/DJL task"
            filePath="notes.txt"
          />
        </div>
      </QueryClientProvider>,
    );

    await expect.element(page.getByText("Plain workspace notes")).toBeInTheDocument();
    expect(mocks.readFile).toHaveBeenCalledWith({
      cwd: "/tmp/DJL task",
      relativePath: "notes.txt",
    });
    expect(mocks.previewDocument).not.toHaveBeenCalled();
  });
});
