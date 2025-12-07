/**
 * CloudFilePickerModal Component
 *
 * Wrapper component that renders the CloudFilePicker component
 * No API instantiation needed - uses generated React Query hooks directly
 */

import { memo, useMemo } from "react";

import { CloudFilePicker } from "../CloudFilePicker/CloudFilePicker";

import type {
  CloudProvider,
  SelectedCloudFile,
} from "@/lib/api/cloudProviders/types";
import type { FileType } from "@/utils/fileTypes";

export interface CloudFilePickerModalProps {
  /** Whether the modal is open */
  isOpen: boolean;
  /** Callback when modal is closed */
  onClose: () => void;
  /** Cloud provider to use */
  provider: CloudProvider;
  /** Accepted file types (extensions or mime types) */
  acceptedFileTypes?: FileType[];
  /** Allow multiple file selection */
  multiple?: boolean;
  /** Maximum number of files to select */
  maxFiles?: number;
  /** Callback when files are selected */
  onFilesSelected: (files: SelectedCloudFile[]) => void;
  /** Optional chat ID to associate files with */
  chatId?: string;
}

/**
 * CloudFilePickerModal
 *
 * Wraps the CloudFilePicker component.
 * The CloudFilePicker uses generated React Query hooks directly.
 */
export const CloudFilePickerModal = memo<CloudFilePickerModalProps>(
  ({
    isOpen,
    onClose,
    provider,
    acceptedFileTypes = [],
    multiple = false,
    maxFiles = 5,
    onFilesSelected,
    chatId,
  }) => {
    // Convert FileType[] to string[] for CloudFilePicker
    // FileType is a union type like "pdf" | "document" | "image" etc.
    // CloudFilePicker expects mime types or file extensions as strings
    const acceptedFileTypesAsStrings = useMemo(() => {
      return acceptedFileTypes as unknown as string[];
    }, [acceptedFileTypes]);

    return (
      <CloudFilePicker
        provider={provider}
        isOpen={isOpen}
        onClose={onClose}
        onFilesSelected={onFilesSelected}
        multiple={multiple}
        maxFiles={maxFiles}
        acceptedFileTypes={acceptedFileTypesAsStrings}
        chatId={chatId}
      />
    );
  },
);

// eslint-disable-next-line lingui/no-unlocalized-strings
CloudFilePickerModal.displayName = "CloudFilePickerModal";
