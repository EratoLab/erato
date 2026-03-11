// import Image from "next/image"; // Removed Next.js Image import
import { t } from "@lingui/core/macro";

import { Button } from "@/components/ui/Controls/Button";
import { Alert } from "@/components/ui/Feedback/Alert";

import { ModalBase } from "./ModalBase";

import type { FileUploadItem } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type React from "react";

const getPreviewUrl = (
  file: Pick<FileUploadItem, "preview_url">,
): string | undefined =>
  typeof file.preview_url === "string" ? file.preview_url : undefined;

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
  const previewUrl = getPreviewUrl(file);
  const canPreview = (isImage || isPdf) && Boolean(previewUrl);
  const actionButtons = (
    <div className="mt-4 flex flex-wrap justify-center gap-3">
      {file.download_url && (
        <Button
          // eslint-disable-next-line lingui/no-unlocalized-strings
          onClick={() => window.open(file.download_url, "_blank")}
          variant="primary"
        >
          {t`Download File`}
        </Button>
      )}
    </div>
  );

  const renderPreview = () => {
    if (isImage && previewUrl) {
      return (
        <>
          <img
            src={previewUrl}
            alt={`${t`Preview of`} ${file.filename}`}
            className="mx-auto max-h-[75vh] max-w-full object-contain"
          />
          {actionButtons}
        </>
      );
    }

    if (isPdf && previewUrl) {
      return (
        <>
          <iframe
            src={previewUrl}
            title={`${t`Preview of`} ${file.filename}`}
            data-testid="file-preview-pdf"
            className="h-[75vh] w-full border-0"
          />
          {actionButtons}
        </>
      );
    }

    return (
      <div className="text-center">
        <Alert type="info" className="mb-4">
          {t`Preview is not available for this file type.`}
        </Alert>
        {actionButtons}
      </div>
    );
  };

  return (
    <ModalBase
      isOpen={isOpen}
      onClose={onClose}
      title={`${t`Preview:`} ${file.filename}`}
      // Adjust size for preview content
      contentClassName={canPreview ? "max-w-4xl" : "max-w-md"}
    >
      {renderPreview()}
    </ModalBase>
  );
};

// eslint-disable-next-line lingui/no-unlocalized-strings
FilePreviewModal.displayName = "FilePreviewModal";
