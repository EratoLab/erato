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
  /**
   * Files this predicate accepts skip the `maxSize` gate. For a file the drop
   * handler expands rather than uploads — an .eml whose attachments the user
   * can still drop — refusing it here costs them the only route to a version
   * that fits. Whatever such a file ultimately uploads is still preflighted.
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

  // The size rule runs as a per-file validator rather than react-dropzone's
  // flat `maxSize` so `isSizeExempt` can spare individual files.
  //
  // Only a size known to exceed the limit rejects. During a drag the browser
  // exposes `DataTransferItem`s with no `size`, and react-dropzone runs this
  // same validator to decide `isDragAccept` — treating an unknown size as
  // oversized would hide the drop overlay for every drag. This mirrors
  // react-dropzone's own `fileMatchSize`, which skips undefined sizes.
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
      // Surface file-too-large rejections immediately so the owning component
      // updates its error state before the upload hook's own preflight fires.
      // `maxSize` keeps these files out of `acceptedFiles`, so the preflight
      // never sees them — reporting here is the only chance to tell the user.
      let files = acceptedFiles;
      if (rejectedFiles.length > 0) {
        const oversized = oversizedRejectionNames(rejectedFiles);
        if (oversized.length > 0) {
          reportError(new UploadTooLargeError(maxSizeFormatted, oversized));
          // Uploads stay atomic, so accepted siblings are withheld — except
          // the size-exempt ones, which the handler stages rather than
          // transmits. Abandoning those would lose an email the user could
          // still trim to fit because a PDF beside it was too big.
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
