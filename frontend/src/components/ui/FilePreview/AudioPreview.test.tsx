import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "@/components/providers/ThemeProvider";

import { FilePreviewContent } from "./FilePreviewContent";

describe("FilePreviewContent audio", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("plays a recorded transcription through an audio element", async () => {
    const recording = new Uint8Array([82, 73, 70, 70]).buffer;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          ({ ok: true, arrayBuffer: async () => recording }) as Response,
      ),
    );
    const createObjectURL = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:recording");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);

    render(
      <FilePreviewContent
        filename="audio-transcription-1.wav"
        url="/api/v1beta/files/1/preview"
        mimeType="audio/*"
      />,
    );

    const preview = await screen.findByTestId("file-preview-audio");
    expect(preview.querySelector("audio")).toHaveAttribute(
      "src",
      "blob:recording",
    );
    // The preview endpoint answers with application/octet-stream.
    expect((createObjectURL.mock.calls[0][0] as Blob).type).toBe("audio/wav");
  });

  it("explains a recording that could not be loaded", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 404 }) as Response),
    );

    render(
      <ThemeProvider enableCustomTheme={false}>
        <FilePreviewContent
          filename="voicemail.mp3"
          url="/api/v1beta/files/2/preview"
        />
      </ThemeProvider>,
    );

    expect(
      await screen.findByTestId("file-preview-audio-error"),
    ).toBeInTheDocument();
  });
});
