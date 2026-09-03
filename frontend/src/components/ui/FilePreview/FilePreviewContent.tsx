import { t } from "@lingui/core/macro";
import { lazy, Suspense } from "react";
import { ErrorBoundary } from "react-error-boundary";

import { Alert } from "@/components/ui/Feedback/Alert";
import { FilePreviewLoading } from "@/components/ui/FileUpload/FilePreviewLoading";

import { EmlPreview } from "./EmlPreview";
import { TeamsTranscriptPreview } from "./TeamsTranscriptPreview";

import type { FileUploadItem } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type React from "react";

// PDFium and its plugin graph are the heaviest viewer in this bundle, and the
// add-in task pane pays for every byte of the library entry. Split so opening
// a chat costs nothing until a PDF is actually previewed.
const PdfPreview = lazy(async () => ({
  // eslint-disable-next-line lingui/no-unlocalized-strings
  default: (await import("./PdfPreview")).PdfPreview,
}));
const DocxPreview = lazy(async () => ({
  // eslint-disable-next-line lingui/no-unlocalized-strings
  default: (await import("./DocxPreview")).DocxPreview,
}));
const PptxPreview = lazy(async () => ({
  // eslint-disable-next-line lingui/no-unlocalized-strings
  default: (await import("./PptxPreview")).PptxPreview,
}));
const XlsxPreview = lazy(async () => ({
  // eslint-disable-next-line lingui/no-unlocalized-strings
  default: (await import("./XlsxPreview")).XlsxPreview,
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

const LazyPreview: React.FC<{
  children: React.ReactNode;
  errorTestId: string;
  loadingLabel: string;
}> = ({ children, errorTestId, loadingLabel }) => (
  <ErrorBoundary
    fallback={
      <div className="p-4 text-center" data-testid={errorTestId}>
        <Alert type="warning" className="mb-4">
          {t({
            id: "filePreview.previewUnavailable",
            message:
              "Preview unavailable: this file viewer could not be loaded.",
          })}
        </Alert>
      </div>
    }
  >
    <Suspense
      fallback={
        <div className="flex min-h-[50vh] items-center justify-center">
          <FilePreviewLoading label={loadingLabel} description="" />
        </div>
      }
    >
      {children}
    </Suspense>
  </ErrorBoundary>
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
const MARKDOWN_MIME_TYPE =
  // eslint-disable-next-line lingui/no-unlocalized-strings
  "text/markdown";

function isImageMime(mimeType: string | undefined): boolean {
  return mimeType?.startsWith(IMAGE_MIME_PREFIX) ?? false;
}

/** Which inline viewer draws a file; null when none can. */
export type PreviewKind =
  | "image"
  | "pdf"
  | "eml"
  | "docx"
  | "pptx"
  | "xlsx"
  | "markdown";

/**
 * The single answer to "can this be previewed, and by what".
 *
 * Both readers of it need the same answer for different reasons: the modal
 * decides whether to offer a preview at all, this component decides which
 * viewer to mount. They used to hold separate lists, which drifted the moment
 * a type was added to one — a file the renderer could draw was refused
 * upstream and the user got "not available" with no way to tell why.
 */
export function resolvePreviewKind(
  filename: string,
  mimeType?: string,
): PreviewKind | null {
  const extension = getExtension(filename);
  if (
    IMAGE_EXTENSIONS.includes(extension as (typeof IMAGE_EXTENSIONS)[number]) ||
    isImageMime(mimeType)
  ) {
    return "image";
  }
  if (extension === "pdf" || mimeType === "application/pdf") return "pdf";
  if (extension === "eml" || mimeType === "message/rfc822") return "eml";
  if (extension === "docx" || mimeType === DOCX_MIME_TYPE) return "docx";
  if (
    extension === "ppt" ||
    extension === "pptx" ||
    mimeType === PPT_MIME_TYPE ||
    mimeType === PPTX_MIME_TYPE
  ) {
    return "pptx";
  }
  if (extension === "xlsx" || mimeType === XLSX_MIME_TYPE) return "xlsx";
  // The preview endpoint types `.md` as application/octet-stream, so only the
  // extension identifies it; whether it is really a transcript is settled by
  // sniffing the bytes, and plain markdown still renders as text.
  if (extension === "md" || mimeType === MARKDOWN_MIME_TYPE) return "markdown";
  return null;
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
   * Other files the viewer may resolve against. Only viewers that reference
   * uploads by name use it — a Teams transcript names what rode along with it
   * but does not carry the bytes.
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
  const kind = resolvePreviewKind(filename, mimeType);

  if (kind === "image") {
    return (
      <img
        src={url}
        alt={t`Preview of ${filename}`}
        className="mx-auto max-h-[75vh] max-w-full object-contain"
      />
    );
  }

  if (kind === "pdf") {
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

  if (kind === "eml") {
    return <EmlPreview filename={filename} url={url} />;
  }

  if (kind === "docx") {
    return (
      <LazyPreview
        errorTestId="file-preview-docx-chunk-error"
        loadingLabel={t({
          id: "filePreview.docxLoading",
          message: "Loading document preview...",
        })}
      >
        <DocxPreview url={url} />
      </LazyPreview>
    );
  }

  if (kind === "pptx") {
    return (
      <LazyPreview
        errorTestId="file-preview-pptx-chunk-error"
        loadingLabel={t({
          id: "filePreview.pptxLoading",
          message: "Loading presentation preview...",
        })}
      >
        <PptxPreview url={url} />
      </LazyPreview>
    );
  }

  if (kind === "xlsx") {
    return (
      <LazyPreview
        errorTestId="file-preview-xlsx-chunk-error"
        loadingLabel={t({
          id: "filePreview.xlsxLoading",
          message: "Loading spreadsheet preview...",
        })}
      >
        <XlsxPreview filename={filename} url={url} />
      </LazyPreview>
    );
  }

  if (kind === "markdown") {
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
