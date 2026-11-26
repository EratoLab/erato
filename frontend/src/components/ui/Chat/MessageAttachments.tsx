import { t } from "@lingui/core/macro";
import { Download } from "iconoir-react";
import { useMemo } from "react";

import { Button } from "@/components/ui/Controls/Button";
import { AttachmentTile } from "@/components/ui/FileUpload/AttachmentTile";
import { AttachmentTileList } from "@/components/ui/FileUpload/AttachmentTileList";
import { AudioTranscriptExcerpt } from "@/components/ui/FileUpload/AudioTranscriptExcerpt";
import {
  getFileName,
  getFilePreviewUrl,
} from "@/components/ui/FileUpload/FilePreviewBase";
import { GroupedFileAttachmentsPreview } from "@/components/ui/FileUpload/GroupedFileAttachmentsPreview";
import { useResolvedFiles } from "@/hooks/files/useResolvedFiles";
import { useStoredTeamsTranscriptIndexes } from "@/hooks/teams/useStoredTeamsTranscriptIndexes";
import { downloadFile } from "@/lib/fileDownload";
import { buildTeamsMessageAttachmentGroups } from "@/utils/teams/teamsAttachmentGroups";
import { groupTeamsSentAttachments } from "@/utils/teams/teamsSentAttachmentGroups";
import { teamsUploadDisplayName } from "@/utils/teams/teamsUploadName";

import { messageAttachmentFileIds } from "./messageAttachmentFileIds";

import type { AttachmentTileProps } from "@/components/ui/FileUpload/AttachmentTile";
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
  showDownload?: boolean;
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
  const resolvedById: Partial<Record<string, FileUploadItem>> =
    useResolvedFiles(fileIds, filesById);

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
  // it. Ungrouped they read as unrelated siblings. Until a transcript's index
  // has been read — or when it has none — the picker's minted names still say
  // which files belong together.
  const files = useMemo(
    () => items.map((item) => item.file as FileUploadItem),
    [items],
  );
  const transcriptIndexes = useStoredTeamsTranscriptIndexes(files);
  const teamsGrouping = useMemo(
    () =>
      buildTeamsMessageAttachmentGroups(files, transcriptIndexes) ??
      groupTeamsSentAttachments(files),
    [files, transcriptIndexes],
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

const renderDownloadableAttachment = (props: AttachmentTileProps) => {
  const { file } = props;
  if (
    !("download_url" in file) ||
    !file.download_url ||
    file.file_contents_unavailable_missing_permissions
  ) {
    return <AttachmentTile {...props} />;
  }

  const { download_url: downloadUrl } = file;
  const filename = getFileName(file);
  const label = t({
    id: "chat.file.download_output",
    message: `Download ${filename}`,
  });

  return (
    <div className="flex min-w-0 max-w-full items-center gap-1">
      <AttachmentTile {...props} className="min-w-0 shrink" />
      <Button
        variant="secondary"
        geometry="icon"
        size="md"
        className="shrink-0"
        icon={<Download className="size-5" aria-hidden="true" />}
        aria-label={label}
        title={label}
        onClick={(event) => {
          downloadFile(
            {
              name: filename,
              content: getFilePreviewUrl(file) ?? downloadUrl,
            },
            // eslint-disable-next-line lingui/no-unlocalized-strings -- window.open options
            () => window.open(downloadUrl, "_blank", "noopener"),
            event.currentTarget,
          );
        }}
      />
    </div>
  );
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
  showDownload = false,
}) => {
  const { items, teamsGrouping } = useAttachmentTiles(fileIds, filesById);
  const renderAttachment = showDownload
    ? renderDownloadableAttachment
    : undefined;

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
            renderAttachment={renderAttachment}
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
      renderAttachment={renderAttachment}
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
