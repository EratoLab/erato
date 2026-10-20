import { plural, t } from "@lingui/core/macro";

import { teamsTranscriptChipText } from "@/utils/teams/teamsTranscriptContext";

import { TeamsTranscriptDetail } from "./TeamsTranscriptDetail";

import type { TeamsTranscriptNamedUpload } from "./TeamsTranscriptDetail";
import type { ComposerContextItem } from "@/components/ui/Chat/ComposerContext/types";
import type { TeamsTranscriptIndexRead } from "@/hooks/teams/useTeamsTranscriptIndex";
import type { FileUploadItem } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

/** What a transcript chip needs: its uploads, not the local file they came from. */
export interface TeamsTranscriptItemEntry {
  /** Stable across "Edit selection", so the chip updates in place. */
  id: string;
  uploads: { transcript: FileUploadItem; assets: readonly FileUploadItem[] };
  /**
   * Upload names of files the transcript brought that the composer did not
   * take, e.g. past its file limit. The detail says so in their section.
   */
  notAttachedAssetNames?: readonly string[];
  onRemove: () => void;
  /** Omitted where the picker can't run; the detail then has no such action. */
  onEditSelection?: () => void;
}

export interface TeamsTranscriptContextOptions {
  /** Unstages one of a transcript's files. */
  onRemoveFile: (fileId: string) => void;
  onFilePreview?: (file: TeamsTranscriptNamedUpload) => void;
}

export const teamsTranscriptItemId = (entryId: string) =>
  `teams.transcript:${entryId}`;

/**
 * One Teams transcript as a composer chip, from its uploads and whatever its
 * index read has given so far. The composer and the edit lane both build
 * through here, so a transcript reads the same in either.
 */
export function teamsTranscriptContextItem(
  entry: TeamsTranscriptItemEntry,
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
          reading={read.isReading}
          assets={assets}
          notAttached={entry.notAttachedAssetNames}
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
