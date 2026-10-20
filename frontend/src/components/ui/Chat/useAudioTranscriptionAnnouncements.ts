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

/**
 * What a staged recording's transcription ended in, said once as it leaves an
 * in-progress phase: the tile only redraws, and a busy tile is no live region.
 * A recording first seen in an end state (mount, another chat) says nothing.
 */
export const useAudioTranscriptionAnnouncements = (
  attachedFiles: readonly FileUploadItem[],
  scopeKey: string | null | undefined,
): string => {
  const [text, announce] = useLiveAnnouncement();
  const phasesRef = useRef(new Map<string, AudioTranscriptionPhase>());
  const scopeRef = useRef(scopeKey);

  useEffect(() => {
    if (scopeRef.current !== scopeKey) {
      scopeRef.current = scopeKey;
      phasesRef.current = new Map();
    }
    const previous = phasesRef.current;
    const next = new Map<string, AudioTranscriptionPhase>();
    for (const file of attachedFiles) {
      if (!file.audio_transcription) {
        continue;
      }
      const phase = audioTranscriptionPhase(file.audio_transcription);
      next.set(file.id, phase);
      const before = previous.get(file.id);
      if (before && IN_PROGRESS.has(before) && !IN_PROGRESS.has(phase)) {
        const outcome = audioTranscriptionOutcomeText(file.filename, phase);
        if (outcome) {
          announce(outcome);
        }
      }
    }
    phasesRef.current = next;
  }, [attachedFiles, scopeKey, announce]);

  return text;
};
