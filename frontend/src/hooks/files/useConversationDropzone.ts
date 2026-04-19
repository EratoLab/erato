import { useCallback, useMemo } from "react";
import { useDropzone } from "react-dropzone";

import { FileTypeUtil } from "@/utils/fileTypes";

import type { FileUploadItem } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { FileType } from "@/utils/fileTypes";

interface UseConversationDropzoneOptions {
  uploadFiles: (files: File[]) => Promise<FileUploadItem[] | undefined>;
  /** Called after a successful drop-upload with the resulting items. */
  onUploaded: (items: FileUploadItem[]) => void;
  acceptedFileTypes?: FileType[];
  /**
   * Extra MIME-keyed entries merged into the dropzone accept map. Useful for
   * surfaces that accept file types not declared by backend capabilities —
   * e.g. the Outlook add-in accepting `.eml`/`.msg` drops of email messages.
   */
  extraAcceptMimeTypes?: Record<string, string[]>;
  isUploading?: boolean;
}

interface ConversationDropzoneBindings {
  getRootProps: () => Record<string, unknown>;
  getInputProps: () => Record<string, unknown>;
  isDragActive: boolean;
  isDragAccept: boolean;
}

/**
 * Shared desktop-file drop-to-upload wiring for the conversation area. Used
 * by both the main Chat component and the Outlook add-in's AddinChat — the
 * caller owns the overlay JSX since task-pane and full-app layouts differ.
 *
 * Root/input props are returned as plain records so consumers in a different
 * workspace (with its own React/csstype pins) can spread them without type
 * collisions across package boundaries.
 */
export function useConversationDropzone({
  uploadFiles,
  onUploaded,
  acceptedFileTypes,
  extraAcceptMimeTypes,
  isUploading = false,
}: UseConversationDropzoneOptions): ConversationDropzoneBindings {
  const handleDrop = useCallback(
    (files: File[]) => {
      if (files.length === 0) {
        return;
      }
      void uploadFiles(files).then((uploaded) => {
        if (uploaded && uploaded.length > 0) {
          onUploaded(uploaded);
        }
      });
    },
    [onUploaded, uploadFiles],
  );

  const accept = useMemo(() => {
    const base =
      acceptedFileTypes && acceptedFileTypes.length > 0
        ? FileTypeUtil.getAcceptObject(acceptedFileTypes)
        : undefined;
    if (!extraAcceptMimeTypes || Object.keys(extraAcceptMimeTypes).length === 0) {
      return base;
    }
    return { ...(base ?? {}), ...extraAcceptMimeTypes };
  }, [acceptedFileTypes, extraAcceptMimeTypes]);

  const { getRootProps, getInputProps, isDragActive, isDragAccept } =
    useDropzone({
      onDrop: handleDrop,
      accept,
      multiple: true,
      disabled: isUploading,
      noClick: true,
      noKeyboard: true,
    });

  return { getRootProps, getInputProps, isDragActive, isDragAccept };
}
