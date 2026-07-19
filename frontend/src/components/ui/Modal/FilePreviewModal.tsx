import { t } from "@lingui/core/macro";

import { Button } from "@/components/ui/Controls/Button";
import { Alert } from "@/components/ui/Feedback/Alert";
import { FilePreviewContent } from "@/components/ui/FilePreview/FilePreviewContent";

import { ModalBase } from "./ModalBase";

import type { FileUploadItem } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type React from "react";

const IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "gif", "webp", "svg", "bmp"];
const DOCX_MIME_TYPE =
  // eslint-disable-next-line lingui/no-unlocalized-strings
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PPT_MIME_TYPE =
  // eslint-disable-next-line lingui/no-unlocalized-strings
  "application/vnd.ms-powerpoint";
const PPTX_MIME_TYPE =
  // eslint-disable-next-line lingui/no-unlocalized-strings
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const XLSX_MIME_TYPE =
  // eslint-disable-next-line lingui/no-unlocalized-strings
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

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
  const mimeType = file.file_capability.mime_types[0];
  if (
    IMAGE_EXTENSIONS.includes(extension) ||
    extension === "pdf" ||
    extension === "eml" ||
    extension === "docx" ||
    extension === "ppt" ||
    extension === "pptx" ||
    extension === "xlsx" ||
    mimeType === DOCX_MIME_TYPE ||
    mimeType === PPT_MIME_TYPE ||
    mimeType === PPTX_MIME_TYPE ||
    mimeType === XLSX_MIME_TYPE
  ) {
    return { url: previewUrl ?? "", canPreview: Boolean(previewUrl) };
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
          <FilePreviewContent
            filename={file.filename}
            url={url}
            mimeType={file.file_capability.mime_types[0]}
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
      contentClassName={canPreview ? "max-w-4xl" : "max-w-md"}
    >
      {renderPreview()}
    </ModalBase>
  );
};

// eslint-disable-next-line lingui/no-unlocalized-strings
FilePreviewModal.displayName = "FilePreviewModal";
