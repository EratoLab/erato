/**
 * useCloudSelection hook
 *
 * Manages selected files state with validation and type filtering
 */

import { useCallback, useState } from "react";

import { FileTypeUtil } from "@/utils/fileTypes";

import type {
  CloudItem,
  SelectedCloudFile,
} from "@/lib/api/cloudProviders/types";

interface UseCloudSelectionOptions {
  /** Allow multiple file selection */
  multiple?: boolean;
  /** Maximum number of files to select */
  maxFiles?: number;
  /** Accepted file types (extensions or mime types) */
  acceptedFileTypes?: string[];
}

interface UseCloudSelectionResult {
  /** Currently selected files */
  selectedFiles: SelectedCloudFile[];
  /** Toggle selection of a file */
  toggleFile: (item: CloudItem) => void;
  /** Check if a file is selected */
  isSelected: (itemId: string) => boolean;
  /** Check if a file can be selected (not disabled) */
  canSelect: (item: CloudItem) => boolean;
  /** Get reason why a file cannot be selected */
  getDisabledReason: (item: CloudItem) => string | null;
  /** Clear all selections */
  clearSelection: () => void;
  /** Check if max files limit is reached */
  isMaxReached: boolean;
}

export function useCloudSelection({
  multiple = false,
  maxFiles = 5,
  acceptedFileTypes = [],
}: UseCloudSelectionOptions = {}): UseCloudSelectionResult {
  const [selectedFiles, setSelectedFiles] = useState<SelectedCloudFile[]>([]);

  const isFileTypeAccepted = useCallback(
    (item: CloudItem): boolean => {
      // Folders are never selectable
      if (item.is_folder) {
        return false;
      }

      // If no filter is set, accept all files
      if (acceptedFileTypes.length === 0) {
        return true;
      }

      // Check against mime type
      if (item.mime_type) {
        const fileType = FileTypeUtil.getTypeFromMimeType(item.mime_type);
        if (fileType && acceptedFileTypes.includes(fileType)) {
          return true;
        }

        // Check if mime type is directly in accepted list
        if (acceptedFileTypes.includes(item.mime_type)) {
          return true;
        }
      }

      // Check against file extension
      const extension = item.name.split(".").pop()?.toLowerCase();
      if (extension && acceptedFileTypes.includes(extension)) {
        return true;
      }

      return false;
    },
    [acceptedFileTypes],
  );

  const isSelected = useCallback(
    (itemId: string): boolean => {
      return selectedFiles.some((file) => file.item_id === itemId);
    },
    [selectedFiles],
  );

  const getDisabledReason = useCallback(
    (item: CloudItem): string | null => {
      if (item.is_folder) {
        return null; // Folders are navigable, not disabled
      }

      if (!isFileTypeAccepted(item)) {
        // eslint-disable-next-line lingui/no-unlocalized-strings
        return "File type not supported at the moment";
      }

      if (
        !isSelected(item.id) &&
        selectedFiles.length >= maxFiles &&
        multiple
      ) {
        // eslint-disable-next-line lingui/no-unlocalized-strings
        return `Maximum ${maxFiles} files can be selected`;
      }

      return null;
    },
    [isFileTypeAccepted, isSelected, selectedFiles.length, maxFiles, multiple],
  );

  const canSelect = useCallback(
    (item: CloudItem): boolean => {
      return getDisabledReason(item) === null;
    },
    [getDisabledReason],
  );

  const toggleFile = useCallback(
    (item: CloudItem) => {
      // Cannot select folders
      if (item.is_folder) {
        return;
      }

      // Check if file can be selected
      if (!canSelect(item) && !isSelected(item.id)) {
        return;
      }

      setSelectedFiles((prev) => {
        const isCurrentlySelected = prev.some(
          (file) => file.item_id === item.id,
        );

        if (isCurrentlySelected) {
          // Deselect
          return prev.filter((file) => file.item_id !== item.id);
        }

        // Select
        const newFile: SelectedCloudFile = {
          drive_id: item.drive_id,
          item_id: item.id,
          name: item.name,
          mime_type: item.mime_type,
          size: item.size,
          provider: item.provider,
        };

        if (multiple) {
          // Add to selection if under limit
          if (prev.length < maxFiles) {
            return [...prev, newFile];
          }
          return prev;
        }

        // Single selection mode: replace
        return [newFile];
      });
    },
    [canSelect, isSelected, multiple, maxFiles],
  );

  const clearSelection = useCallback(() => {
    setSelectedFiles([]);
  }, []);

  const isMaxReached = selectedFiles.length >= maxFiles && multiple;

  return {
    selectedFiles,
    toggleFile,
    isSelected,
    canSelect,
    getDisabledReason,
    clearSelection,
    isMaxReached,
  };
}
