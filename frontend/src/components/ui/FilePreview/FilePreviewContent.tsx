import { t } from "@lingui/core/macro";

import { Alert } from "@/components/ui/Feedback/Alert";

import { DocxPreview } from "./DocxPreview";
import { EmlPreview } from "./EmlPreview";

import type React from "react";

const IMAGE_EXTENSIONS = [
  "jpg",
  "jpeg",
  "png",
  "gif",
  "webp",
  "svg",
  "bmp",
] as const;

function getExtension(filename: string): string {
  return filename.split(".").pop()?.toLowerCase() ?? "";
}

// eslint-disable-next-line lingui/no-unlocalized-strings
const IMAGE_MIME_PREFIX = "image/";
const DOCX_MIME_TYPE =
  // eslint-disable-next-line lingui/no-unlocalized-strings
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function isImageMime(mimeType: string | undefined): boolean {
  return mimeType?.startsWith(IMAGE_MIME_PREFIX) ?? false;
}

export interface FilePreviewContentProps {
  filename: string;
  url: string;
  /**
   * Hints the renderer when the filename extension is missing or misleading
   * (e.g. nested email attachments named `attached_message` with MIME type
   * `message/rfc822`). When absent, routing falls back to extension alone.
   */
  mimeType?: string;
}

/**
 * Capability-routed renderer for a single previewable file. Picks the right
 * inline viewer (image, PDF, EML, …) from the filename and optional mime
 * type. Used by the modal for top-level files and by EmlPreview for nested
 * email attachments — so clicking a PDF inside an email opens the same PDF
 * viewer as clicking a PDF at the top level.
 */
export const FilePreviewContent: React.FC<FilePreviewContentProps> = ({
  filename,
  url,
  mimeType,
}) => {
  const extension = getExtension(filename);
  const isImage =
    IMAGE_EXTENSIONS.includes(extension as (typeof IMAGE_EXTENSIONS)[number]) ||
    isImageMime(mimeType);
  const isPdf = extension === "pdf" || mimeType === "application/pdf";
  const isEml = extension === "eml" || mimeType === "message/rfc822";
  const isDocx = extension === "docx" || mimeType === DOCX_MIME_TYPE;

  if (isImage) {
    return (
      <img
        src={url}
        alt={t`Preview of ${filename}`}
        className="mx-auto max-h-[75vh] max-w-full object-contain"
      />
    );
  }

  if (isPdf) {
    return (
      <iframe
        src={url}
        title={t`Preview of ${filename}`}
        data-testid="file-preview-pdf"
        className="h-[75vh] w-full border-0"
      />
    );
  }

  if (isEml) {
    return <EmlPreview filename={filename} url={url} />;
  }

  if (isDocx) {
    return <DocxPreview url={url} />;
  }

  return (
    <div className="text-center">
      <Alert type="info" className="mb-4">
        {t`Preview is not available for this file type.`}
      </Alert>
    </div>
  );
};

// eslint-disable-next-line lingui/no-unlocalized-strings
FilePreviewContent.displayName = "FilePreviewContent";
