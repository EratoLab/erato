import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";

import { AttachmentTileList } from "@/components/ui/FileUpload/AttachmentTileList";
import { getFileQuery } from "@/lib/generated/v1betaApi/v1betaApiComponents";
import { useV1betaApiContext } from "@/lib/generated/v1betaApi/v1betaApiContext";
import { teamsUploadDisplayName } from "@/utils/teams/teamsUploadName";

import type { AttachmentTileItem } from "@/components/ui/FileUpload/AttachmentTileList";
import type { FileUploadItem } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
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

const getPreviewUrl = (file: FileUploadItem): string =>
  typeof file.preview_url === "string" ? file.preview_url : file.download_url;

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
            previewUrl: getPreviewUrl(file),
          },
        ];
      }),
    [fileIds, resolvedById],
  );

  if (items.length === 0) {
    return null;
  }

  return (
    <AttachmentTileList
      items={items}
      size="medium"
      expandable
      className="mt-2"
      onActivate={
        onFilePreview
          ? (item) => onFilePreview(item.file as FileUploadItem, relatedFiles)
          : undefined
      }
    />
  );
};
