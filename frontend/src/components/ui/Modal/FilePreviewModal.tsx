import { t } from "@lingui/core/macro";

import { Button } from "@/components/ui/Controls/Button";
import { Alert } from "@/components/ui/Feedback/Alert";
import {
  FilePreviewContent,
  resolvePreviewKind,
} from "@/components/ui/FilePreview/FilePreviewContent";

import { ModalBase } from "./ModalBase";

import type { FileUploadItem } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type React from "react";

const getPreviewUrl = (
  file: Pick<FileUploadItem, "preview_url">,
): string | undefined =>
  typeof file.preview_url === "string" ? file.preview_url : undefined;

/**
 * Asks the renderer itself what it can draw, rather than keeping a second list
 * beside it. The two used to be maintained separately and drifted: a type the
 * renderer handled was refused here, and the user saw "not available" for a
 * file that was perfectly previewable.
 */
const resolvePreviewSource = (
  file: FileUploadItem,
): { url: string; canPreview: boolean } => {
  const previewUrl = getPreviewUrl(file);
  const kind = resolvePreviewKind(
    file.filename,
    file.file_capability.mime_types[0],
  );
  if (kind === null) {
    return { url: "", canPreview: false };
  }
  return { url: previewUrl ?? "", canPreview: Boolean(previewUrl) };
};

interface FilePreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  file: FileUploadItem | null;
  /**
   * Replaces the "not previewable" body when the caller knows why no preview
   * source exists. Callers that withhold a preview URL for reasons other than
   * the file type — a size refusal, a failed fetch — would otherwise show a
   * wrong explanation.
   */
  notPreviewableReason?: string;
  /**
   * Files the previewed one can be resolved against. Forwarded to viewers that
   * reference other uploads by name rather than carrying their bytes.
   */
  relatedFiles?: readonly FileUploadItem[];
}

/**
 * Modal specifically for displaying file previews.
 */
export const FilePreviewModal: React.FC<FilePreviewModalProps> = ({
  isOpen,
  onClose,
  file,
  notPreviewableReason,
  relatedFiles,
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
            relatedFiles={relatedFiles}
          />
          {actionButtons}
        </>
      );
    }

    return (
      <div className="text-center">
        <Alert type="info" className="mb-4">
          {notPreviewableReason ??
            t`Preview is not available for this file type.`}
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
