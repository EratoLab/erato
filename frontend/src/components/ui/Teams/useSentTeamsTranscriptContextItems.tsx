import { useMemo, useRef } from "react";

import { useStoredTeamsTranscriptReads } from "@/hooks/teams/useStoredTeamsTranscriptIndexes";
import { teamsSentTranscripts } from "@/utils/teams/teamsSentTranscripts";

import { teamsTranscriptContextItem } from "./teamsTranscriptContextItem";

import type { ComposerContextItem } from "@/components/ui/Chat/ComposerContext/types";
import type { FileUploadItem } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

export interface SentTeamsTranscriptOptions {
  /** Drops files from the message being edited. */
  onRemoveFiles: (fileIds: string[]) => void;
  onFilePreview?: (file: FileUploadItem) => void;
}

const sameList = (a: readonly unknown[], b: readonly unknown[]) =>
  a.length === b.length && a.every((value, index) => value === b[index]);

/**
 * The Teams transcripts of a message being edited, as the composer shows
 * them: one chip per transcript that stands for its files, read from the
 * stored upload. The picker cannot reopen a sent selection, so the detail
 * offers no "Edit selection".
 */
export function useSentTeamsTranscriptContextItems(
  files: readonly FileUploadItem[],
  { onRemoveFiles, onFilePreview }: SentTeamsTranscriptOptions,
): ComposerContextItem[] {
  const reads = useStoredTeamsTranscriptReads(files);
  const cacheRef = useRef(
    new Map<string, { deps: unknown[]; item: ComposerContextItem }>(),
  );
  const itemsRef = useRef<ComposerContextItem[]>([]);

  return useMemo(() => {
    const next = new Map<
      string,
      { deps: unknown[]; item: ComposerContextItem }
    >();
    const items = teamsSentTranscripts(files, reads).map(
      ({ transcript, assets, read }) => {
        const deps = [
          transcript,
          ...assets,
          read.index,
          read.isReading,
          onRemoveFiles,
          onFilePreview,
        ];
        const cached = cacheRef.current.get(transcript.id);
        const item =
          cached && sameList(cached.deps, deps)
            ? cached.item
            : teamsTranscriptContextItem(
                {
                  id: transcript.id,
                  uploads: { transcript, assets },
                  onRemove: () =>
                    onRemoveFiles([
                      transcript.id,
                      ...assets.map((file) => file.id),
                    ]),
                },
                read,
                {
                  onRemoveFile: (fileId) => onRemoveFiles([fileId]),
                  onFilePreview,
                },
              );
        next.set(transcript.id, { deps, item });
        return item;
      },
    );
    cacheRef.current = next;
    if (!sameList(itemsRef.current, items)) {
      itemsRef.current = items;
    }
    return itemsRef.current;
  }, [files, reads, onRemoveFiles, onFilePreview]);
}
