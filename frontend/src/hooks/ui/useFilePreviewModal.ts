import { useState, useCallback } from "react";

import { createLogger } from "@/utils/debugLogger";

import type { FileUploadItem } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

const logger = createLogger("HOOK", "useFilePreviewModal");

interface UseFilePreviewModalResult {
  isPreviewModalOpen: boolean;
  fileToPreview: FileUploadItem | null;
  openPreviewModal: (file: FileUploadItem) => void;
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

  // Function to open the modal
  const openPreviewModal = useCallback((file: FileUploadItem) => {
    logger.log("Opening preview for file:", file.filename);
    setFileToPreview(file);
    setIsPreviewModalOpen(true);
  }, []);

  // Function to close the modal
  const closePreviewModal = useCallback(() => {
    logger.log("Closing preview modal");
    setIsPreviewModalOpen(false);
    // Delay clearing the file to prevent content flicker during close animation
    setTimeout(() => setFileToPreview(null), 300);
  }, []);

  return {
    isPreviewModalOpen,
    fileToPreview,
    openPreviewModal,
    closePreviewModal,
  };
}
