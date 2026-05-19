import { t } from "@lingui/core/macro";

import { Button } from "@/components/ui/Controls/Button";
import { Alert } from "@/components/ui/Feedback/Alert";
import { FilePreviewContent } from "@/components/ui/FilePreview/FilePreviewContent";

import { ModalBase } from "./ModalBase";

import type { FileUploadItem } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type React from "react";

const IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "gif", "webp", "svg", "bmp"];

const getExtension = (filename: string): string =>
  filename.split(".").pop()?.toLowerCase() ?? "";

const getPreviewUrl = (
  file: Pick<FileUploadItem, "preview_url">,
): string | undefined =>
  typeof file.preview_url === "string" ? file.preview_url : undefined;

const resolvePreviewSource = (
  file: FileUploadItem,
): { url: string; canPreview: boolean } => {
  const extension = getExtension(file.filename);
  const previewUrl = getPreviewUrl(file);
  if (IMAGE_EXTENSIONS.includes(extension) || extension === "pdf") {
    return { url: previewUrl ?? "", canPreview: Boolean(previewUrl) };
  }
  if (extension === "eml") {
    return {
      url: file.download_url,
      canPreview: Boolean(file.download_url),
    };
  }
  return { url: "", canPreview: false };
};

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

  const isUnavailableMissingPermissions =
    file.file_contents_unavailable_missing_permissions;
  const { url, canPreview } = resolvePreviewSource(file);

  const actionButtons = (
    <div className="mt-4 flex flex-wrap justify-center gap-3">
      {!isUnavailableMissingPermissions && file.download_url && (
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
    if (isUnavailableMissingPermissions) {
      return (
        <div className="text-center">
          <Alert type="warning" className="mb-4">
            {t({
              id: "filePreviewModal.unavailableMissingPermissions",
              message:
                "This file is unavailable because you do not have permission to access it.",
            })}
          </Alert>
        </div>
      );
    }

    if (canPreview) {
      return (
        <>
          <FilePreviewContent filename={file.filename} url={url} />
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
      contentClassName={canPreview ? "max-w-4xl" : "max-w-md"}
    >
      {renderPreview()}
    </ModalBase>
  );
};

// eslint-disable-next-line lingui/no-unlocalized-strings
FilePreviewModal.displayName = "FilePreviewModal";
