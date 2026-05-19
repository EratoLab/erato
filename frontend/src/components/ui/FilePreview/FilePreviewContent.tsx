import { t } from "@lingui/core/macro";

import { Alert } from "@/components/ui/Feedback/Alert";

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

export interface FilePreviewContentProps {
  filename: string;
  url: string;
}

/**
 * Capability-routed renderer for a single previewable file. Picks the right
 * inline viewer (image, PDF, EML, …) from the filename. Used by the modal
 * for top-level files and by EmlPreview for nested email attachments — so
 * clicking a PDF inside an email opens the same PDF viewer as clicking a
 * PDF at the top level.
 */
export const FilePreviewContent: React.FC<FilePreviewContentProps> = ({
  filename,
  url,
}) => {
  const extension = getExtension(filename);

  if (IMAGE_EXTENSIONS.includes(extension as (typeof IMAGE_EXTENSIONS)[number])) {
    return (
      <img
        src={url}
        alt={`${t`Preview of`} ${filename}`}
        className="mx-auto max-h-[75vh] max-w-full object-contain"
      />
    );
  }

  if (extension === "pdf") {
    return (
      <iframe
        src={url}
        title={`${t`Preview of`} ${filename}`}
        data-testid="file-preview-pdf"
        className="h-[75vh] w-full border-0"
      />
    );
  }

  if (extension === "eml") {
    return <EmlPreview filename={filename} url={url} />;
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
