import { useMemo, useRef } from "react";

import { useTeamsTranscriptIndexes } from "@/hooks/teams/useTeamsTranscriptIndex";

import {
  teamsTranscriptContextItem,
  teamsTranscriptItemId,
} from "./teamsTranscriptContextItem";

import type {
  TeamsTranscriptContextOptions,
  TeamsTranscriptItemEntry,
} from "./teamsTranscriptContextItem";
import type { ComposerContextItem } from "@/components/ui/Chat/ComposerContext/types";
import type { TeamsTranscriptIndexRead } from "@/hooks/teams/useTeamsTranscriptIndex";

/** One transcript the composer holds, with the uploads it brought that are still staged. */
export interface TeamsTranscriptContextEntry extends TeamsTranscriptItemEntry {
  /** The local transcript, read for its index block. */
  transcript: File;
}

export { teamsTranscriptItemId };
export type { TeamsTranscriptContextOptions };

const READING: TeamsTranscriptIndexRead = { index: null, isReading: true };

const sameList = (a: readonly unknown[], b: readonly unknown[]) =>
  a.length === b.length && a.every((value, index) => value === b[index]);

/**
 * One composer context item per Teams transcript: the chip, its detail and
 * the files it stands for. `claimsFileIds` are the entry's staged uploads, so
 * the chip owns exactly what the send carries for it.
 *
 * The lane is memoized, so an item keeps its identity until something it
 * shows changes, and the list keeps its identity while every item does.
 */
export function useTeamsTranscriptContextItems(
  entries: readonly TeamsTranscriptContextEntry[],
  options: TeamsTranscriptContextOptions,
): ComposerContextItem[] {
  const { onRemoveFile, onFilePreview } = options;
  const filesRef = useRef<readonly File[]>([]);
  const files = entries.map((entry) => entry.transcript);
  if (!sameList(filesRef.current, files)) {
    filesRef.current = files;
  }
  const reads = useTeamsTranscriptIndexes(filesRef.current);

  const cacheRef = useRef(
    new Map<string, { deps: unknown[]; item: ComposerContextItem }>(),
  );
  const itemsRef = useRef<ComposerContextItem[]>([]);

  return useMemo(() => {
    const next = new Map<
      string,
      { deps: unknown[]; item: ComposerContextItem }
    >();
    const items = entries.map((entry) => {
      const read = reads.get(entry.transcript) ?? READING;
      const deps = [
        entry.transcript,
        entry.uploads.transcript,
        ...entry.uploads.assets,
        entry.notAttachedAssetNames?.join("\n") ?? "",
        read.index,
        read.isReading,
        entry.onRemove,
        entry.onEditSelection,
        onRemoveFile,
        onFilePreview,
      ];
      const cached = cacheRef.current.get(entry.id);
      const item =
        cached && sameList(cached.deps, deps)
          ? cached.item
          : teamsTranscriptContextItem(entry, read, {
              onRemoveFile,
              onFilePreview,
            });
      next.set(entry.id, { deps, item });
      return item;
    });
    cacheRef.current = next;
    if (!sameList(itemsRef.current, items)) {
      itemsRef.current = items;
    }
    return itemsRef.current;
  }, [entries, reads, onRemoveFile, onFilePreview]);
}
