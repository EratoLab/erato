import { useMemo } from "react";

import { AttachmentTileList } from "@/components/ui/FileUpload/AttachmentTileList";
import { useResolvedFiles } from "@/hooks/files/useResolvedFiles";

import type { AttachmentTileItem } from "@/components/ui/FileUpload/AttachmentTileList";
import type { FileUploadItem } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

export interface McpAppViewFilesProps {
  /** The images the call returned, as its output names them. */
  fileIds: readonly string[];
  /** Everything the conversation already knows, keyed by id. */
  filesById: Record<string, FileUploadItem>;
  /** Opens a file in the preview, which also downloads it. */
  onFilePreview?: (file: FileUploadItem) => void;
}

/**
 * The images of a call whose view shows, as small chips under the view: the
 * view already shows what they hold, so each is its name, opened in the file
 * preview, rather than a second full image.
 */
export const McpAppViewFiles = ({
  fileIds,
  filesById,
  onFilePreview,
}: McpAppViewFilesProps) => {
  const resolved: Partial<Record<string, FileUploadItem>> = useResolvedFiles(
    fileIds,
    filesById,
  );
  const items = useMemo<AttachmentTileItem[]>(
    () =>
      fileIds.flatMap((id) => {
        const file = resolved[id];
        // No preview URL: a chip with the name, not a thumbnail.
        return file ? [{ id, file, previewUrl: null }] : [];
      }),
    [fileIds, resolved],
  );

  return (
    <AttachmentTileList
      items={items}
      className="mb-2"
      onActivate={
        onFilePreview
          ? (item) => {
              onFilePreview(item.file as FileUploadItem);
            }
          : undefined
      }
    />
  );
};
