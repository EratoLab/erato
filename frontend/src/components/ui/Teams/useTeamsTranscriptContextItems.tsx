import { plural, t } from "@lingui/core/macro";
import { useMemo, useRef } from "react";

import { useTeamsTranscriptIndexes } from "@/hooks/teams/useTeamsTranscriptIndex";
import { teamsTranscriptChipText } from "@/utils/teams/teamsTranscriptContext";

import { TeamsTranscriptDetail } from "./TeamsTranscriptDetail";

import type { TeamsTranscriptNamedUpload } from "./TeamsTranscriptDetail";
import type { ComposerContextItem } from "@/components/ui/Chat/ComposerContext/types";
import type { TeamsTranscriptIndexRead } from "@/hooks/teams/useTeamsTranscriptIndex";
import type { FileUploadItem } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

/** One transcript the composer holds, with the uploads it brought that are still staged. */
export interface TeamsTranscriptContextEntry {
  /** Stable across "Edit selection", so the chip updates in place. */
  id: string;
  /** The local transcript, read for its index block. */
  transcript: File;
  uploads: { transcript: FileUploadItem; assets: readonly FileUploadItem[] };
  onRemove: () => void;
  /** Omitted where the picker can't run; the detail then has no such action. */
  onEditSelection?: () => void;
}

export interface TeamsTranscriptContextOptions {
  /** Unstages one of a transcript's files. */
  onRemoveFile: (fileId: string) => void;
  onFilePreview?: (file: TeamsTranscriptNamedUpload) => void;
}

const READING: TeamsTranscriptIndexRead = { index: null, isReading: true };

export const teamsTranscriptItemId = (entryId: string) =>
  `teams.transcript:${entryId}`;

function buildItem(
  entry: TeamsTranscriptContextEntry,
  read: TeamsTranscriptIndexRead,
  { onRemoveFile, onFilePreview }: TeamsTranscriptContextOptions,
): ComposerContextItem {
  const text = teamsTranscriptChipText(read.index, {
    reading: read.isReading,
  });
  const assets = entry.uploads.assets;
  const count = assets.length;
  return {
    id: teamsTranscriptItemId(entry.id),
    kind: "teams.transcript",
    origin: "user",
    state: read.isReading ? "loading" : "included",
    label: text.label,
    meta: text.meta,
    spokenLabel: text.spokenLabel,
    icon: "chats",
    claimsFileIds: [
      entry.uploads.transcript.id,
      ...assets.map((file) => file.id),
    ],
    onRemove: entry.onRemove,
    removeLabel: t({
      id: "teams.context.remove",
      message: "Remove Teams transcript",
    }),
    removeActionLabel: t({
      id: "teams.context.removeAction",
      message: "Remove transcript",
    }),
    announcements: {
      removed:
        count > 0
          ? t({
              id: "teams.context.announce.removedWithFiles",
              message: plural(count, {
                one: "Teams transcript removed, with # shared file.",
                other: "Teams transcript removed, with # shared files.",
              }),
            })
          : t({
              id: "teams.context.announce.removed",
              message: "Teams transcript removed.",
            }),
    },
    detail: {
      title: text.spokenLabel,
      render: ({ locked }) => (
        <TeamsTranscriptDetail
          index={read.index}
          assets={assets}
          locked={locked}
          onRemoveFile={onRemoveFile}
          onFilePreview={onFilePreview}
        />
      ),
      actions: entry.onEditSelection
        ? [
            {
              id: "teams.editSelection",
              label: t({
                id: "teams.context.detail.editSelection",
                message: "Edit selection",
              }),
              variant: "primary",
              onSelect: entry.onEditSelection,
            },
          ]
        : [],
    },
  };
}

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
          : buildItem(entry, read, { onRemoveFile, onFilePreview });
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
