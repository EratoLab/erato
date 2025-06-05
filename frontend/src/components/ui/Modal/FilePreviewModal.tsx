// import Image from "next/image"; // Removed Next.js Image import
import React from "react";

import { Button } from "@/components/ui/Controls/Button";
import { Alert } from "@/components/ui/Feedback/Alert";

import { ModalBase } from "./ModalBase";

import type { FileUploadItem } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

interface FilePreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  file: FileUploadItem | null;
}

/**
 * Modal specifically for displaying file previews.
 */
export const FilePreviewModal: React.FC<FilePreviewModalProps> = ({
  isOpen,
  onClose,
  file,
}) => {
  if (!file) {
    return null;
  }

  // Simplified type detection based on extension
  const getExtension = (filename: string): string => {
    return filename.split(".").pop()?.toLowerCase() ?? "";
  };

  const extension = getExtension(file.filename);
  const imageExtensions = ["jpg", "jpeg", "png", "gif", "webp", "svg", "bmp"];
  const isImage = imageExtensions.includes(extension);
  const isPdf = extension === "pdf";
  const canPreview = isImage || isPdf;

  const renderPreview = () => {
    if (isImage && file.download_url) {
      return (
        <img
          src={file.download_url}
          alt={`Preview of ${file.filename}`}
          className="mx-auto max-h-[75vh] max-w-full object-contain"
        />
      );
    }

    if (isPdf && file.download_url) {
      return (
        <iframe
          src={file.download_url}
          title={`Preview of ${file.filename}`}
          className="h-[75vh] w-full border-0"
        />
      );
    }

    return (
      <div className="text-center">
        <Alert type="info" className="mb-4">
          Preview is not available for this file type.
        </Alert>
        {file.download_url && (
          <Button
            onClick={() => window.open(file.download_url, "_blank")}
            variant="primary"
          >
            Download File
          </Button>
        )}
      </div>
    );
  };

  return (
    <ModalBase
      isOpen={isOpen}
      onClose={onClose}
      title={`Preview: ${file.filename}`}
      // Adjust size for preview content
      contentClassName={canPreview ? "max-w-4xl" : "max-w-md"}
    >
      {renderPreview()}
    </ModalBase>
  );
};

FilePreviewModal.displayName = "FilePreviewModal";
