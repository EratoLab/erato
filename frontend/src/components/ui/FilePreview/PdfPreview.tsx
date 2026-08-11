import { createPluginRegistration } from "@embedpdf/core";
import { EmbedPDF } from "@embedpdf/core/react";
import {
  DocumentManagerPluginPackage,
  useActiveDocument,
  useDocumentManagerCapability,
} from "@embedpdf/plugin-document-manager/react";
import {
  InteractionManagerPluginPackage,
  PagePointerProvider,
} from "@embedpdf/plugin-interaction-manager/react";
import {
  RenderLayer,
  RenderPluginPackage,
} from "@embedpdf/plugin-render/react";
import {
  Rotate,
  RotatePluginPackage,
  useRotate,
} from "@embedpdf/plugin-rotate/react";
import {
  Scroller,
  ScrollPluginPackage,
  useScroll,
} from "@embedpdf/plugin-scroll/react";
import { SelectionPluginPackage } from "@embedpdf/plugin-selection/react";
import {
  TilingLayer,
  TilingPluginPackage,
} from "@embedpdf/plugin-tiling/react";
import {
  Viewport,
  ViewportPluginPackage,
} from "@embedpdf/plugin-viewport/react";
import {
  useZoom,
  ZoomMode,
  ZoomPluginPackage,
} from "@embedpdf/plugin-zoom/react";
import { t } from "@lingui/core/macro";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/Controls/Button";
import { Alert } from "@/components/ui/Feedback/Alert";
import { FilePreviewLoading } from "@/components/ui/FileUpload/FilePreviewLoading";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  RotateClockwiseIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from "@/components/ui/icons";

import { createPdfEngine } from "./pdfEngine";

import type { PdfEngine } from "@embedpdf/models";
import type React from "react";

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 8;
const PAGE_GAP = 12;

const PDF_PLUGINS = [
  createPluginRegistration(DocumentManagerPluginPackage),
  createPluginRegistration(ViewportPluginPackage, { viewportGap: PAGE_GAP }),
  createPluginRegistration(ScrollPluginPackage, {
    defaultPageGap: PAGE_GAP,
    defaultBufferSize: 2,
  }),
  createPluginRegistration(RenderPluginPackage),
  // Tiles keep a zoomed-in page sharp without re-rasterising it whole.
  createPluginRegistration(TilingPluginPackage, {
    tileSize: 768,
    overlapPx: 2.5,
    extraRings: 0,
  }),
  createPluginRegistration(InteractionManagerPluginPackage),
  createPluginRegistration(SelectionPluginPackage, {
    marquee: { enabled: false },
  }),
  createPluginRegistration(ZoomPluginPackage, {
    defaultZoomLevel: ZoomMode.FitWidth,
    minZoom: MIN_ZOOM,
    maxZoom: MAX_ZOOM,
  }),
  createPluginRegistration(RotatePluginPackage),
];

interface PdfPreviewProps {
  url: string;
}

const PdfPreviewError: React.FC = () => (
  <div className="p-4 text-center" data-testid="file-preview-pdf-error">
    <Alert type="warning" className="mb-4">
      {t({
        id: "filePreview.pdfPreviewUnavailable",
        message: "Preview unavailable: this document could not be loaded.",
      })}
    </Alert>
  </div>
);

const PdfPreviewLoading: React.FC = () => (
  <div className="flex h-full min-h-[50vh] items-center justify-center">
    <FilePreviewLoading
      label={t({
        id: "filePreview.pdfLoading",
        message: "Loading document preview...",
      })}
      description=""
    />
  </div>
);

const PdfToolbar: React.FC<{ documentId: string }> = ({ documentId }) => {
  const { provides: scroll, state: scrollState } = useScroll(documentId);
  const { provides: zoom, state: zoomState } = useZoom(documentId);
  const { provides: rotate } = useRotate(documentId);
  const { currentPage, totalPages } = scrollState;

  return (
    <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-[var(--pdf-preview-control-border)] bg-[var(--pdf-preview-control-bg)] px-3">
      <div className="flex items-center gap-1">
        <Button
          variant="icon-only"
          size="sm"
          disabled={currentPage <= 1}
          aria-label={t({
            id: "filePreview.pdf.previousPage",
            message: "Previous page",
          })}
          icon={<ChevronLeftIcon className="size-4" />}
          onClick={() => scroll?.scrollToPreviousPage()}
        />
        <span
          className="text-sm tabular-nums text-[var(--pdf-preview-control-fg)]"
          data-testid="file-preview-pdf-page-indicator"
        >
          {t({
            id: "filePreview.pdf.pageIndicator",
            message: `Page ${currentPage} of ${totalPages}`,
          })}
        </span>
        <Button
          variant="icon-only"
          size="sm"
          disabled={currentPage >= totalPages}
          aria-label={t({
            id: "filePreview.pdf.nextPage",
            message: "Next page",
          })}
          icon={<ChevronRightIcon className="size-4" />}
          onClick={() => scroll?.scrollToNextPage()}
        />
      </div>

      <div className="flex items-center gap-1">
        <Button
          variant="icon-only"
          size="sm"
          aria-label={t({ id: "filePreview.pdf.zoomOut", message: "Zoom out" })}
          icon={<ZoomOutIcon className="size-4" />}
          onClick={() => zoom?.zoomOut()}
        />
        <span
          className="w-14 text-center text-sm tabular-nums text-[var(--pdf-preview-control-fg)]"
          data-testid="file-preview-pdf-zoom-indicator"
        >
          {Math.round(zoomState.currentZoomLevel * 100)}%
        </span>
        <Button
          variant="icon-only"
          size="sm"
          aria-label={t({ id: "filePreview.pdf.zoomIn", message: "Zoom in" })}
          icon={<ZoomInIcon className="size-4" />}
          onClick={() => zoom?.zoomIn()}
        />
        <Button
          variant="icon-only"
          size="sm"
          aria-label={t({
            id: "filePreview.pdf.rotate",
            message: "Rotate clockwise",
          })}
          icon={<RotateClockwiseIcon className="size-4" />}
          onClick={() => rotate?.rotateForward()}
        />
      </div>
    </div>
  );
};

/**
 * Opens `url` in the document manager and renders its pages. Split out because
 * the manager capability only resolves inside the `EmbedPDF` plugin registry.
 */
const PdfDocument: React.FC<PdfPreviewProps> = ({ url }) => {
  const { provides: documentManager } = useDocumentManagerCapability();
  const { activeDocumentId, activeDocument } = useActiveDocument();
  const [openFailed, setOpenFailed] = useState(false);
  const openedUrlRef = useRef<string | null>(null);

  useEffect(() => {
    if (!documentManager || openedUrlRef.current === url) {
      return;
    }

    openedUrlRef.current = url;
    setOpenFailed(false);

    const failOpen = () => {
      if (openedUrlRef.current === url) {
        setOpenFailed(true);
      }
    };

    // Always whole-file: the incremental mode needs range requests, which blob
    // URLs cannot serve at all and an auth proxy in front of a preview URL may
    // not either. Previewable files are size-capped, so the one-shot cost is
    // bounded and the behaviour is the same everywhere.
    documentManager
      .openDocumentUrl({ url, mode: "full-fetch" })
      .wait(
        (response) => response.task.wait(() => undefined, failOpen),
        failOpen,
      );
  }, [documentManager, url]);

  if (openFailed || activeDocument?.status === "error") {
    return <PdfPreviewError />;
  }

  if (!activeDocumentId || activeDocument?.status !== "loaded") {
    return <PdfPreviewLoading />;
  }

  return (
    <>
      <PdfToolbar documentId={activeDocumentId} />
      <Viewport
        documentId={activeDocumentId}
        className="min-h-0 flex-1 overflow-auto bg-[var(--pdf-preview-surface-bg)]"
      >
        <Scroller
          documentId={activeDocumentId}
          renderPage={({ pageIndex, width, height }) => (
            <Rotate documentId={activeDocumentId} pageIndex={pageIndex}>
              <PagePointerProvider
                documentId={activeDocumentId}
                pageIndex={pageIndex}
                style={{
                  width,
                  height,
                  background: "var(--pdf-preview-page-bg)",
                  boxShadow: "var(--pdf-preview-page-shadow)",
                }}
              >
                <RenderLayer
                  documentId={activeDocumentId}
                  pageIndex={pageIndex}
                  style={{ position: "absolute" }}
                />
                <TilingLayer
                  documentId={activeDocumentId}
                  pageIndex={pageIndex}
                />
              </PagePointerProvider>
            </Rotate>
          )}
        />
      </Viewport>
    </>
  );
};

/**
 * Client-side PDF viewer. The browser's own viewer is not an option: Teams
 * hosts every tab in a sandboxed iframe, and the HTML spec forbids sandboxed
 * frames from displaying PDFs, so `<iframe src={pdfUrl}>` renders the browser's
 * "content is blocked" page there. PDFium-in-WebAssembly draws into the same
 * frame, exactly as the DOCX/PPTX/XLSX viewers already do.
 */
export const PdfPreview: React.FC<PdfPreviewProps> = ({ url }) => {
  const [engine, setEngine] = useState<PdfEngine | null>(null);

  useEffect(() => {
    // Owned per mount rather than at module scope: the engine holds a worker
    // and a multi-megabyte PDFium heap that an add-in task pane should not
    // carry for the rest of the session.
    const createdEngine = createPdfEngine();
    setEngine(createdEngine);

    return () => {
      setEngine(null);
      createdEngine.destroy?.();
    };
  }, []);

  return (
    <div
      className="pdf-preview-theme flex h-[75vh] flex-col overflow-hidden rounded-md border border-[var(--theme-border-muted)]"
      data-testid="file-preview-pdf"
    >
      {engine ? (
        <EmbedPDF engine={engine} plugins={PDF_PLUGINS}>
          <PdfDocument url={url} />
        </EmbedPDF>
      ) : (
        <PdfPreviewLoading />
      )}
    </div>
  );
};

// eslint-disable-next-line lingui/no-unlocalized-strings
PdfPreview.displayName = "PdfPreview";
