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
  /** Per-file limit in bytes, from `useUploadFeature()`. */
  maxSize?: number;
  /** Formatted limit for the too-large message. */
  maxSizeFormatted?: string;
  /** Where rejections are reported; defaults to the shared upload store. */
  onError?: (error: UploadError) => void;
  /**
   * Skips the size gate for files the handler stages rather than uploads
   * (an .eml the user can still trim). Their uploads are preflighted later.
   */
  isSizeExempt?: (file: File) => boolean;
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
  isSizeExempt,
}: UseConversationDropzoneOptions): ConversationDropzoneBindings {
  const setStoreError = useFileUploadStore((state) => state.setError);
  const reportError = onError ?? setStoreError;

  // A validator instead of `maxSize` so `isSizeExempt` can spare files.
  // Only a known size rejects: dragenter runs this on `DataTransferItem`s
  // that carry none, and rejecting those hides the drop overlay.
  const validateSize = useCallback(
    (file: File) => {
      if (maxSize === undefined) return null;
      if (!(file.size > maxSize)) return null;
      if (isSizeExempt?.(file)) return null;
      return {
        code: "file-too-large",
        // Never shown: the drop handler builds the localized message.
        // eslint-disable-next-line lingui/no-unlocalized-strings
        message: "File is larger than the configured maximum",
      };
    },
    [maxSize, isSizeExempt],
  );
  const handleDrop = useCallback(
    (acceptedFiles: File[], rejectedFiles: FileRejection[]) => {
      // Rejected files never reach the upload preflight; report them here.
      let files = acceptedFiles;
      if (rejectedFiles.length > 0) {
        const oversized = oversizedRejectionNames(rejectedFiles);
        if (oversized.length > 0) {
          reportError(new UploadTooLargeError(maxSizeFormatted, oversized));
          // Uploads stay atomic; exempt files are staged, not sent, so they go on.
          files = isSizeExempt ? acceptedFiles.filter(isSizeExempt) : [];
        }
      }

      if (files.length === 0) {
        return;
      }
      void uploadFiles(files).then((uploaded) => {
        if (uploaded && uploaded.length > 0) {
          onUploaded(uploaded);
        }
      });
    },
    [onUploaded, uploadFiles, reportError, maxSizeFormatted, isSizeExempt],
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
      validator: validateSize,
      noClick: true,
      noKeyboard: true,
    });

  return { getRootProps, getInputProps, isDragActive, isDragAccept };
}
