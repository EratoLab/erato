import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";

import { AttachmentTileList } from "@/components/ui/FileUpload/AttachmentTileList";
import { AudioTranscriptExcerpt } from "@/components/ui/FileUpload/AudioTranscriptExcerpt";
import {
  getFileName,
  getFilePreviewUrl,
} from "@/components/ui/FileUpload/FilePreviewBase";
import { GroupedFileAttachmentsPreview } from "@/components/ui/FileUpload/GroupedFileAttachmentsPreview";
import { getFileQuery } from "@/lib/generated/v1betaApi/v1betaApiComponents";
import { useV1betaApiContext } from "@/lib/generated/v1betaApi/v1betaApiContext";
import { groupTeamsSentAttachments } from "@/utils/teams/teamsSentAttachmentGroups";
import { teamsUploadDisplayName } from "@/utils/teams/teamsUploadName";

import { messageAttachmentFileIds } from "./messageAttachmentFileIds";

import type { AttachmentTileItem } from "@/components/ui/FileUpload/AttachmentTileList";
import type { FileUploadItem } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { UiChatMessage } from "@/utils/adapters/messageAdapter";
import type { TeamsSentAttachmentGrouping } from "@/utils/teams/teamsSentAttachmentGroups";
import type React from "react";

export interface MessageAttachmentsProps {
  /** File ids carried by the message, in the order they were attached. */
  fileIds: string[];
  /** Everything the conversation already knows, keyed by id. */
  filesById: Record<string, FileUploadItem>;
  /** Handed to the preview so it can offer navigation between siblings. */
  relatedFiles: readonly FileUploadItem[];
  onFilePreview?: (
    file: FileUploadItem,
    relatedFiles?: readonly FileUploadItem[],
  ) => void;
}

export interface MessageAttachmentFiles {
  /** Tiles to draw, in attachment order, minus the ids that do not resolve. */
  items: AttachmentTileItem[];
  /** Handed to the preview so it can offer navigation between siblings. */
  relatedFiles: readonly FileUploadItem[];
  /** Set only where a Teams transcript claims the files shared inside it. */
  teamsGrouping: TeamsSentAttachmentGrouping | null;
}

/**
 * The model reads the transcript from the upload itself, not from the message
 * text, so this is the only place a sent recording's words can be shown.
 */
function completedAudioTranscript(file: FileUploadItem): string | undefined {
  const transcription = file.audio_transcription;
  if (transcription?.status?.toLowerCase() !== "completed") {
    return undefined;
  }
  // The generated schema types `transcript` as always empty.
  const transcript = (
    transcription.transcript as string | null | undefined
  )?.trim();
  if (!transcript) {
    return undefined;
  }
  return transcript;
}

/**
 * Resolve a message's attachment ids to drawable tiles.
 *
 * The lookup order, the fallback fetch, the Teams display name and the Teams
 * grouping all live here, so `MessageAttachments` and any renderer drawing its
 * own tiles run the same resolution rather than two copies of it. The copy the
 * openwebui kit carries had already drifted into refetching every attachment
 * the conversation was holding all along.
 */
const useAttachmentTiles = (
  fileIds: readonly string[],
  filesById: Record<string, FileUploadItem>,
): Omit<MessageAttachmentFiles, "relatedFiles"> => {
  const { queryOptions, fetcherOptions } = useV1betaApiContext({});

  const missingIds = useMemo(
    () => fileIds.filter((fileId) => !(fileId in filesById)),
    [fileIds, filesById],
  );

  const fetched = useQueries({
    queries: missingIds.map((fileId) => ({
      ...getFileQuery({ ...fetcherOptions, pathParams: { fileId } }),
      ...queryOptions,
      staleTime: Infinity,
    })),
  });

  // `Partial` because a lookup can genuinely miss — a file still in flight —
  // while a plain index signature would claim every key resolves.
  const resolvedById = useMemo<Partial<Record<string, FileUploadItem>>>(() => {
    const map: Partial<Record<string, FileUploadItem>> = {};
    missingIds.forEach((fileId, index) => {
      const file = fetched[index]?.data;
      if (file) {
        map[fileId] = file;
      }
    });
    // The conversation's own records are the freshest, so they win.
    return { ...map, ...filesById };
  }, [missingIds, fetched, filesById]);

  const items = useMemo<AttachmentTileItem[]>(
    () =>
      fileIds.flatMap((fileId) => {
        const file = resolvedById[fileId];
        if (!file) {
          return [];
        }

        // A Teams upload is named after its bytes so the backend can join it
        // to the message that carried it. That name is a key, not something to
        // read, so recover the readable part where one exists.
        const displayName = teamsUploadDisplayName(file.filename);

        return [
          {
            id: fileId,
            file: displayName ? { ...file, displayName } : file,
            previewUrl: getFilePreviewUrl(file),
            transcript: completedAudioTranscript(file),
          },
        ];
      }),
    [fileIds, resolvedById],
  );

  // A Teams conversation arrives as a transcript plus the files shared inside
  // it. Ungrouped they read as unrelated siblings.
  const teamsGrouping = useMemo(
    () =>
      groupTeamsSentAttachments(
        items.map((item) => item.file as FileUploadItem),
      ),
    [items],
  );

  return { items, teamsGrouping };
};

/**
 * Everything a message's attachments need before anything is drawn, keyed off
 * the message itself.
 *
 * The id union is the part a renderer gets wrong on its own: an assistant's
 * generated documents arrive as content parts, not as upload ids. The sibling
 * list is the other: without it the preview opens on an island and offers no
 * navigation. Both are derived here so a `ChatMessageRenderer` override keeps
 * only its markup.
 */
export const useMessageAttachmentFiles = (
  message: UiChatMessage,
  filesById: Record<string, FileUploadItem>,
): MessageAttachmentFiles => {
  const fileIds = useMemo(() => messageAttachmentFileIds(message), [message]);
  // Every file the chat knows about, so a viewer can resolve one its own
  // artifact only names — the transcript's uploads are the case in point.
  const relatedFiles = useMemo(() => Object.values(filesById), [filesById]);

  return { ...useAttachmentTiles(fileIds, filesById), relatedFiles };
};

/**
 * Attachments of a sent message, drawn with the shared tile.
 *
 * The conversation already carries its file records, so ids are resolved from
 * that map rather than refetched one request per attachment. Only ids missing
 * from it fall back to a fetch — an optimistic message can name a file before
 * its metadata has been rehydrated.
 */
export const MessageAttachments: React.FC<MessageAttachmentsProps> = ({
  fileIds,
  filesById,
  relatedFiles,
  onFilePreview,
}) => {
  const { items, teamsGrouping } = useAttachmentTiles(fileIds, filesById);

  if (items.length === 0) {
    return null;
  }

  if (teamsGrouping) {
    const ungrouped = items.filter(
      (item) => !teamsGrouping.claimedFileIds.has(item.id),
    );

    return (
      <div className="mt-2 flex flex-col gap-2">
        <GroupedFileAttachmentsPreview
          groups={teamsGrouping.groups}
          onFilePreview={(file) =>
            onFilePreview?.(file as FileUploadItem, relatedFiles)
          }
        />
        {ungrouped.length > 0 && (
          <AttachmentTileList
            items={ungrouped}
            size="medium"
            onActivate={
              onFilePreview
                ? (item) =>
                    onFilePreview(item.file as FileUploadItem, relatedFiles)
                : undefined
            }
          />
        )}
      </div>
    );
  }

  const transcribed = items.filter((item) => item.transcript);
  const tileList = (
    <AttachmentTileList
      items={items}
      size="medium"
      expandable
      className={transcribed.length > 0 ? undefined : "mt-2"}
      onActivate={
        onFilePreview
          ? (item) => onFilePreview(item.file as FileUploadItem, relatedFiles)
          : undefined
      }
    />
  );

  if (transcribed.length === 0) {
    return tileList;
  }

  return (
    <div className="mt-2 flex flex-col gap-2">
      {tileList}
      {transcribed.map((item) => (
        <AudioTranscriptExcerpt
          key={item.id}
          transcript={item.transcript ?? ""}
          label={transcribed.length > 1 ? getFileName(item.file) : undefined}
        />
      ))}
    </div>
  );
};
