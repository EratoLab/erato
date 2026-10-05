import { t } from "@lingui/core/macro";
import { useEffect, useState } from "react";

import { Alert } from "@/components/ui/Feedback/Alert";
import { FilePreviewLoading } from "@/components/ui/FileUpload/FilePreviewLoading";

import type React from "react";

type LoadState =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; objectUrl: string };

/* eslint-disable lingui/no-unlocalized-strings */
const AUDIO_MIME_BY_EXTENSION: Record<string, string> = {
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  mp4: "audio/mp4",
  wav: "audio/wav",
  aac: "audio/aac",
  flac: "audio/flac",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  opus: "audio/ogg",
  webm: "audio/webm",
};
const GENERIC_AUDIO_MIME = "audio/*";
const FALLBACK_AUDIO_MIME = "audio/wav";
/* eslint-enable lingui/no-unlocalized-strings */

function audioMimeType(filename: string, mimeType?: string): string {
  const extension = filename.split(".").pop()?.toLowerCase() ?? "";
  const byExtension = AUDIO_MIME_BY_EXTENSION[extension];
  if (byExtension) {
    return byExtension;
  }
  return mimeType && mimeType !== GENERIC_AUDIO_MIME
    ? mimeType
    : FALLBACK_AUDIO_MIME;
}

interface AudioPreviewProps {
  filename: string;
  url: string;
  mimeType?: string;
}

export const AudioPreview: React.FC<AudioPreviewProps> = ({
  filename,
  url,
  mimeType,
}) => {
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | undefined;

    setState({ kind: "loading" });

    const load = async () => {
      try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) {
          throw new Error(`Audio preview fetch failed: ${response.status}`);
        }
        const bytes = await response.arrayBuffer();
        // The preview endpoint serves audio as application/octet-stream, so
        // the blob carries the type the player needs.
        objectUrl = URL.createObjectURL(
          new Blob([bytes], { type: audioMimeType(filename, mimeType) }),
        );
        setState({ kind: "ready", objectUrl });
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === "AbortError") {
          return;
        }
        setState({ kind: "error" });
      }
    };

    void load();

    return () => {
      controller.abort();
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [filename, mimeType, url]);

  if (state.kind === "error") {
    return (
      <div className="text-center" data-testid="file-preview-audio-error">
        <Alert type="warning" className="mb-4">
          {t({
            id: "filePreview.audioPreviewUnavailable",
            message: "Preview unavailable: this recording could not be loaded.",
          })}
        </Alert>
      </div>
    );
  }

  if (state.kind === "loading") {
    return (
      <div className="flex min-h-[20vh] items-center justify-center">
        <FilePreviewLoading
          label={t({
            id: "filePreview.audioLoading",
            message: "Loading recording...",
          })}
          description=""
        />
      </div>
    );
  }

  return (
    <div className="flex justify-center py-6" data-testid="file-preview-audio">
      {/* Transcribed recordings carry their text as a separate attachment
          field; there is no caption track to attach. */}
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio
        controls
        src={state.objectUrl}
        className="w-full max-w-xl"
        aria-label={t({
          id: "filePreview.audioPlayerLabel",
          message: `Play ${filename}`,
        })}
      />
    </div>
  );
};

// eslint-disable-next-line lingui/no-unlocalized-strings
AudioPreview.displayName = "AudioPreview";
