import { useState, useCallback } from "react";

import { createLogger } from "@/utils/debugLogger";

import type { FileUploadItem } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

const logger = createLogger("HOOK", "useFilePreviewModal");

interface UseFilePreviewModalResult {
  isPreviewModalOpen: boolean;
  fileToPreview: FileUploadItem | null;
  /** The files the previewed one arrived with; empty when the caller has none. */
  relatedFiles: readonly FileUploadItem[];
  openPreviewModal: (
    file: FileUploadItem,
    relatedFiles?: readonly FileUploadItem[],
  ) => void;
  closePreviewModal: () => void;
}

/**
 * Hook to manage the state and callbacks for the file preview modal.
 */
export function useFilePreviewModal(): UseFilePreviewModalResult {
  const [isPreviewModalOpen, setIsPreviewModalOpen] = useState(false);
  const [fileToPreview, setFileToPreview] = useState<FileUploadItem | null>(
    null,
  );
  // Some viewers reference their siblings by name rather than carrying them —
  // a Teams transcript names the uploads that rode along with it.
  const [relatedFiles, setRelatedFiles] = useState<readonly FileUploadItem[]>(
    [],
  );

  // Function to open the modal
  const openPreviewModal = useCallback(
    (file: FileUploadItem, related: readonly FileUploadItem[] = []) => {
      logger.log("Opening preview for file:", file.filename);
      setFileToPreview(file);
      setRelatedFiles(related);
      setIsPreviewModalOpen(true);
    },
    [],
  );

  // Function to close the modal
  const closePreviewModal = useCallback(() => {
    logger.log("Closing preview modal");
    setIsPreviewModalOpen(false);
    // Delay clearing the file to prevent content flicker during close animation
    setTimeout(() => {
      setFileToPreview(null);
      setRelatedFiles([]);
    }, 300);
  }, []);

  return {
    isPreviewModalOpen,
    fileToPreview,
    relatedFiles,
    openPreviewModal,
    closePreviewModal,
  };
}
