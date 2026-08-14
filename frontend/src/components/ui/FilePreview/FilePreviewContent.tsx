import { t } from "@lingui/core/macro";
import { lazy, Suspense } from "react";
import { ErrorBoundary } from "react-error-boundary";

import { Alert } from "@/components/ui/Feedback/Alert";
import { FilePreviewLoading } from "@/components/ui/FileUpload/FilePreviewLoading";

import { DocxPreview } from "./DocxPreview";
import { EmlPreview } from "./EmlPreview";
import { PptxPreview } from "./PptxPreview";
import { TeamsTranscriptPreview } from "./TeamsTranscriptPreview";
import { XlsxPreview } from "./XlsxPreview";

import type { FileUploadItem } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type React from "react";

// PDFium and its plugin graph are the heaviest viewer in this bundle, and the
// add-in task pane pays for every byte of the library entry. Split so opening
// a chat costs nothing until a PDF is actually previewed.
const PdfPreview = lazy(async () => ({
  // eslint-disable-next-line lingui/no-unlocalized-strings
  default: (await import("./PdfPreview")).PdfPreview,
}));

const PdfPreviewUnavailable: React.FC = () => (
  <div className="p-4 text-center" data-testid="file-preview-pdf-error">
    <Alert type="warning" className="mb-4">
      {t({
        id: "filePreview.pdfPreviewUnavailable",
        message: "Preview unavailable: this document could not be loaded.",
      })}
    </Alert>
  </div>
);

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
const PPT_MIME_TYPE =
  // eslint-disable-next-line lingui/no-unlocalized-strings
  "application/vnd.ms-powerpoint";
const PPTX_MIME_TYPE =
  // eslint-disable-next-line lingui/no-unlocalized-strings
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const XLSX_MIME_TYPE =
  // eslint-disable-next-line lingui/no-unlocalized-strings
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

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
  /**
   * Other files available beside this one. Only viewers that reference their
   * siblings by name use it — a Teams transcript names the uploads that rode
   * along with it but does not carry their bytes.
   */
  relatedFiles?: readonly FileUploadItem[];
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
  relatedFiles,
}) => {
  const extension = getExtension(filename);
  const isImage =
    IMAGE_EXTENSIONS.includes(extension as (typeof IMAGE_EXTENSIONS)[number]) ||
    isImageMime(mimeType);
  const isPdf = extension === "pdf" || mimeType === "application/pdf";
  const isEml = extension === "eml" || mimeType === "message/rfc822";
  const isDocx = extension === "docx" || mimeType === DOCX_MIME_TYPE;
  const isPptx =
    extension === "ppt" ||
    extension === "pptx" ||
    mimeType === PPT_MIME_TYPE ||
    mimeType === PPTX_MIME_TYPE;
  const isXlsx = extension === "xlsx" || mimeType === XLSX_MIME_TYPE;
  // Routed on the extension alone: the preview endpoint types `.md` as
  // `application/octet-stream`, so the mime says nothing. Whether this really
  // is a transcript is settled by sniffing the fetched bytes, and a plain
  // markdown file still renders as text — better than the dead end below.
  const isMarkdown = extension === "md" || mimeType === "text/markdown";

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
      // Nothing above this renders a boundary — not Chat, not the add-in shell
      // — so a rejected chunk import (a deploy rotated the hash under an open
      // tab, or the network dropped) would otherwise unmount the whole React
      // root and leave a blank page behind.
      <ErrorBoundary FallbackComponent={PdfPreviewUnavailable}>
        <Suspense
          fallback={
            <div className="flex min-h-[50vh] items-center justify-center">
              <FilePreviewLoading
                label={t({
                  id: "filePreview.pdfLoading",
                  message: "Loading document preview...",
                })}
                description=""
              />
            </div>
          }
        >
          <PdfPreview url={url} />
        </Suspense>
      </ErrorBoundary>
    );
  }

  if (isEml) {
    return <EmlPreview filename={filename} url={url} />;
  }

  if (isDocx) {
    return <DocxPreview url={url} />;
  }

  if (isPptx) {
    return <PptxPreview url={url} />;
  }

  if (isXlsx) {
    return <XlsxPreview filename={filename} url={url} />;
  }

  if (isMarkdown) {
    return (
      <TeamsTranscriptPreview
        filename={filename}
        url={url}
        relatedFiles={relatedFiles}
      />
    );
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
