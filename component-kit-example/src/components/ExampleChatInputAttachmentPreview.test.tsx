import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { audioTranscriptionTileStatus } from "@erato/frontend/shared";

import { ExampleChatInputAttachmentPreview } from "./ExampleChatInputAttachmentPreview";

import type { ChatInputAttachmentPreviewProps } from "@erato/frontend/library";

i18n.loadAndActivate({ locale: "en", messages: {} });

afterEach(cleanup);

const files = [
  { id: "f1", filename: "contract-v3.pdf" },
  { id: "f2", filename: "pricing.xlsx" },
] as ChatInputAttachmentPreviewProps["attachedFiles"];

const renderPreview = (
  props: Partial<ChatInputAttachmentPreviewProps> = {},
) => {
  const handlers = {
    onRemoveFile: vi.fn(),
    onRemoveAllFiles: vi.fn(),
    onFilePreview: vi.fn(),
  };
  render(
    <I18nProvider i18n={i18n}>
      <ExampleChatInputAttachmentPreview
        {...({
          attachedFiles: files,
          maxFiles: 4,
          disabled: false,
          ...handlers,
          ...props,
        } as ChatInputAttachmentPreviewProps)}
      />
    </I18nProvider>,
  );
  return handlers;
};

it("previews a file from its name and removes it only from its named x", () => {
  const { onRemoveFile, onFilePreview } = renderPreview();

  fireEvent.click(screen.getByRole("button", { name: "contract-v3.pdf" }));
  expect(onFilePreview).toHaveBeenCalledWith(files[0]);
  expect(onRemoveFile).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole("button", { name: "Remove pricing.xlsx" }));
  expect(onRemoveFile).toHaveBeenCalledExactlyOnceWith("f2");
  expect(onFilePreview).toHaveBeenCalledOnce();
});

it("words Remove all", () => {
  const { onRemoveAllFiles, onRemoveFile } = renderPreview();
  fireEvent.click(screen.getByRole("button", { name: "Remove all" }));
  expect(onRemoveAllFiles).toHaveBeenCalledOnce();
  expect(onRemoveFile).not.toHaveBeenCalled();
});

it("shows a plain name when the host offers no preview", () => {
  renderPreview({ onFilePreview: undefined });
  expect(screen.queryByRole("button", { name: "contract-v3.pdf" })).toBeNull();
  expect(screen.getByText("contract-v3.pdf")).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "Remove contract-v3.pdf" }),
  ).toBeTruthy();
});

// The host's words come from the host's catalog, which this test does not
// load, so the status is held to what the shared helper returns.
const statusOf = (
  file: ChatInputAttachmentPreviewProps["attachedFiles"][number],
) => audioTranscriptionTileStatus(file)?.metaLabel;
const statusSpans = () => [
  ...document.querySelectorAll<HTMLElement>(
    ".erato-component-kit-example-file-status",
  ),
];

const recordings = [
  {
    id: "r1",
    filename: "audio-recording-1.wav",
    audio_transcription: { status: "processing" },
  },
  {
    id: "r2",
    filename: "audio-recording-2.wav",
    audio_transcription: { status: "failed", error: "Timed out." },
  },
] as unknown as ChatInputAttachmentPreviewProps["attachedFiles"];

it("shows a recording's status and retries it when the host can", () => {
  const onRetry = vi.fn();
  renderPreview({
    attachedFiles: recordings,
    audioTranscription: {
      canRetry: (id) => id === "r2",
      retryingFileId: null,
      onRetry,
      disabled: false,
    },
  });
  const [busy, failed] = statusSpans();
  expect(busy.textContent).toBe(statusOf(recordings[0]));
  expect(busy.dataset.status).toBe("busy");
  expect(failed.textContent).toBe(statusOf(recordings[1]));
  expect(failed.dataset.status).toBe("error");
  expect(failed.getAttribute("title")).toBe("Timed out.");
  expect(
    screen.getAllByRole("button", { name: /^Retry transcription/ }),
  ).toHaveLength(1);
  fireEvent.click(
    screen.getByRole("button", {
      name: "Retry transcription: audio-recording-2.wav",
    }),
  );
  expect(onRetry).toHaveBeenCalledExactlyOnceWith("r2");
});

it("offers no retry without the host's controls", () => {
  renderPreview({ attachedFiles: recordings });
  expect(statusSpans()).toHaveLength(2);
  expect(
    screen.queryByRole("button", { name: /^Retry transcription/ }),
  ).toBeNull();
});
