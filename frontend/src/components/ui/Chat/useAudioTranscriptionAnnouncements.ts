import { useEffect, useRef } from "react";

import {
  audioTranscriptionOutcomeText,
  audioTranscriptionPhase,
} from "@/components/ui/FileUpload/audioTranscriptionStatus";

import { useLiveAnnouncement } from "./ComposerContext/useLiveAnnouncement";

import type { AudioTranscriptionPhase } from "@/components/ui/FileUpload/audioTranscriptionStatus";
import type { FileUploadItem } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

const IN_PROGRESS: ReadonlySet<AudioTranscriptionPhase> = new Set([
  "recording",
  "uploading",
  "transcribing",
]);

interface SeenRecording {
  filename: string;
  phase: AudioTranscriptionPhase;
}

/**
 * What a staged recording's transcription ended in, said once as it leaves an
 * in-progress phase: the tile only redraws, and a busy tile is no live region.
 * A recording first seen in an end state (mount, another chat) says nothing.
 * One that leaves the composer while in progress was canceled: removing it
 * stops its transcription, and Send waits for it, so nothing else takes it.
 */
export const useAudioTranscriptionAnnouncements = (
  attachedFiles: readonly FileUploadItem[],
  scopeKey: string | null | undefined,
): string => {
  const [text, announce] = useLiveAnnouncement();
  const seenRef = useRef(new Map<string, SeenRecording>());
  const scopeRef = useRef(scopeKey);

  useEffect(() => {
    if (scopeRef.current !== scopeKey) {
      scopeRef.current = scopeKey;
      seenRef.current = new Map();
    }
    const previous = seenRef.current;
    const next = new Map<string, SeenRecording>();
    for (const file of attachedFiles) {
      if (!file.audio_transcription) {
        continue;
      }
      const phase = audioTranscriptionPhase(file.audio_transcription);
      next.set(file.id, { filename: file.filename, phase });
      const before = previous.get(file.id);
      if (before && IN_PROGRESS.has(before.phase) && !IN_PROGRESS.has(phase)) {
        const outcome = audioTranscriptionOutcomeText(file.filename, phase);
        if (outcome) {
          announce(outcome);
        }
      }
    }
    for (const [fileId, before] of previous) {
      if (!next.has(fileId) && IN_PROGRESS.has(before.phase)) {
        const outcome = audioTranscriptionOutcomeText(
          before.filename,
          "canceled",
        );
        if (outcome) {
          announce(outcome);
        }
      }
    }
    seenRef.current = next;
  }, [attachedFiles, scopeKey, announce]);

  return text;
};
