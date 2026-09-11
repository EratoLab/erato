import { useCallback, useMemo, useRef, type DragEvent } from "react";
import { useDropzone } from "react-dropzone";

import {
  UnsupportedFileTypeError,
  UploadTooLargeError,
  type UploadError,
} from "@/hooks/files/errors";
import { useFileUploadStore } from "@/hooks/files/useFileUploadStore";
import { FileTypeUtil } from "@/utils/fileTypes";
import {
  oversizedRejectionNames,
  rejectionNames,
} from "@/utils/validateFileSizes";

import type { FileUploadItem } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { FileType } from "@/utils/fileTypes";
import type { FileRejection } from "react-dropzone";

interface UseConversationDropzoneOptions {
  uploadFiles: (files: File[]) => Promise<FileUploadItem[] | undefined>;
  /** Called after a successful drop-upload with the resulting items. */
  onUploaded: (items: FileUploadItem[]) => void;
  acceptedFileTypes?: FileType[];
  /**
   * Extra MIME-keyed entries merged into the dropzone accept map once
   * `acceptedFileTypes` is known. Useful for surfaces that accept file types
   * not declared by backend capabilities — e.g. the Outlook add-in accepting
   * `.eml`/`.msg` drops of email messages.
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
  /**
   * Fires on the raw drop event with the number of dropped files, before
   * react-dropzone has read or validated them. May return a release that is
   * called once the drop reaches the handler (which then owns the signal).
   */
  onReceive?: (count: number) => void | (() => void);
}

type RootProps = Record<string, unknown>;

interface ConversationDropzoneBindings {
  getRootProps: (props?: RootProps) => RootProps;
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
  onReceive,
}: UseConversationDropzoneOptions): ConversationDropzoneBindings {
  const setStoreError = useFileUploadStore((state) => state.setError);
  const reportError = onError ?? setStoreError;
  const receiveReleaseRef = useRef<(() => void) | null>(null);

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
  const releaseReceive = useCallback(() => {
    receiveReleaseRef.current?.();
    receiveReleaseRef.current = null;
  }, []);
  const handleDrop = useCallback(
    (acceptedFiles: File[], rejectedFiles: FileRejection[]) => {
      releaseReceive();
      // Rejected files never reach the upload preflight; report them here.
      let files = acceptedFiles;
      if (rejectedFiles.length > 0) {
        const unsupported = rejectionNames(rejectedFiles, "file-invalid-type");
        if (unsupported.length > 0) {
          reportError(new UnsupportedFileTypeError(unsupported));
        }
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
    [
      onUploaded,
      uploadFiles,
      reportError,
      maxSizeFormatted,
      isSizeExempt,
      releaseReceive,
    ],
  );
  // react-dropzone reads the dropped items before onDrop; when that read
  // fails (an item of kind "file" that yields no File) onDrop never runs.
  const handleReadError = useCallback(
    (error: Error) => {
      console.error(error);
      releaseReceive();
    },
    [releaseReceive],
  );

  const accept = useMemo(() => {
    // No capability types yet (still loading) means accept everything so the
    // drop overlay shows; the upload preflight validates types regardless.
    if (!acceptedFileTypes || acceptedFileTypes.length === 0) {
      return undefined;
    }
    const base = FileTypeUtil.getAcceptObject(acceptedFileTypes);
    if (
      !extraAcceptMimeTypes ||
      Object.keys(extraAcceptMimeTypes).length === 0
    ) {
      return base;
    }
    return { ...base, ...extraAcceptMimeTypes };
  }, [acceptedFileTypes, extraAcceptMimeTypes]);

  const {
    getRootProps: getDropzoneRootProps,
    getInputProps,
    isDragActive,
    isDragAccept,
  } = useDropzone({
    onDrop: handleDrop,
    onError: handleReadError,
    accept,
    multiple: true,
    disabled: isUploading,
    validator: validateSize,
    noClick: true,
    noKeyboard: true,
  });

  // react-dropzone runs a caller's onDrop before its own, so this sees the
  // event first; a file drop then reaches handleDrop or handleReadError.
  const handleReceive = useCallback(
    (event: DragEvent) => {
      if (!onReceive) return;
      // Typed non-null by React, absent on some synthetic drops.
      const transfer = event.dataTransfer as DataTransfer | null;
      if (!transfer || !isFileDrag(transfer)) return;
      const count = droppedFileCount(transfer);
      if (count === 0) return;
      receiveReleaseRef.current?.();
      const release = onReceive(count);
      receiveReleaseRef.current =
        typeof release === "function" ? release : null;
    },
    [onReceive],
  );
  const getRootProps = useCallback(
    (props: RootProps = {}) => {
      if (!onReceive) return getDropzoneRootProps(props);
      const consumerOnDrop = props.onDrop;
      return getDropzoneRootProps({
        ...props,
        onDrop: (event: DragEvent) => {
          if (typeof consumerOnDrop === "function") consumerOnDrop(event);
          // A stopped event never reaches react-dropzone, so nothing would
          // release the span.
          if (event.isPropagationStopped()) return;
          handleReceive(event);
        },
      });
    },
    [getDropzoneRootProps, handleReceive, onReceive],
  );

  return { getRootProps, getInputProps, isDragActive, isDragAccept };
}

// Mirrors react-dropzone's own file-drag test so a string-only drag (an
// Outlook mail-list row) never announces files that will not arrive.
function isFileDrag(transfer: DataTransfer): boolean {
  return Array.from(transfer.types).some(
    (type) => type === "Files" || type === "application/x-moz-file",
  );
}

function droppedFileCount(transfer: DataTransfer): number {
  if (transfer.files.length > 0) return transfer.files.length;
  return Array.from(transfer.items).filter((item) => item.kind === "file")
    .length;
}
