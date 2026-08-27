import { useCallback, useMemo } from "react";
import { useDropzone } from "react-dropzone";

import { UploadTooLargeError, type UploadError } from "@/hooks/files/errors";
import { useFileUploadStore } from "@/hooks/files/useFileUploadStore";
import { FileTypeUtil } from "@/utils/fileTypes";
import { oversizedRejectionNames } from "@/utils/validateFileSizes";

import type { FileUploadItem } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { FileType } from "@/utils/fileTypes";
import type { FileRejection } from "react-dropzone";

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
  /**
   * Maximum file size in bytes. When provided, react-dropzone rejects
   * oversized files before they reach `uploadFiles`. Pair with `onError` to
   * surface the rejection to the user. Read from `useUploadFeature()`.
   */
  maxSize?: number;
  /**
   * Human-readable formatted maximum size (e.g. "20 MB"). Included in the
   * `UploadTooLargeError` passed to `onError` when a file exceeds `maxSize`.
   */
  maxSizeFormatted?: string;
  /**
   * Called when the dropzone rejects a file (e.g. file-too-large). Use this
   * to route errors into the owning upload-error state so they are visible to
   * the user without waiting for the upload hook's own preflight.
   */
  onError?: (error: UploadError) => void;
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
  maxSize,
  maxSizeFormatted,
  onError,
}: UseConversationDropzoneOptions): ConversationDropzoneBindings {
  const setStoreError = useFileUploadStore((state) => state.setError);
  const reportError = onError ?? setStoreError;
  const handleDrop = useCallback(
    (acceptedFiles: File[], rejectedFiles: FileRejection[]) => {
      // Surface file-too-large rejections immediately so the owning component
      // updates its error state before the upload hook's own preflight fires.
      // `maxSize` keeps these files out of `acceptedFiles`, so the preflight
      // never sees them — reporting here is the only chance to tell the user.
      if (rejectedFiles.length > 0) {
        const oversized = oversizedRejectionNames(rejectedFiles);
        if (oversized.length > 0) {
          reportError(new UploadTooLargeError(maxSizeFormatted, oversized));
          return;
        }
      }

      if (acceptedFiles.length === 0) {
        return;
      }
      void uploadFiles(acceptedFiles).then((uploaded) => {
        if (uploaded && uploaded.length > 0) {
          onUploaded(uploaded);
        }
      });
    },
    [onUploaded, uploadFiles, reportError, maxSizeFormatted],
  );

  const accept = useMemo(() => {
    const base =
      acceptedFileTypes && acceptedFileTypes.length > 0
        ? FileTypeUtil.getAcceptObject(acceptedFileTypes)
        : undefined;
    if (
      !extraAcceptMimeTypes ||
      Object.keys(extraAcceptMimeTypes).length === 0
    ) {
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
      maxSize,
      noClick: true,
      noKeyboard: true,
    });

  return { getRootProps, getInputProps, isDragActive, isDragAccept };
}
