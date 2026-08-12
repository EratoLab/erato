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
  useScrollCapability,
} from "@embedpdf/plugin-scroll/react";
import {
  SelectionLayer,
  SelectionPluginPackage,
  useSelectionCapability,
} from "@embedpdf/plugin-selection/react";
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

import { copyTextToClipboard } from "./copySelectionText";
import { getPdfEngine } from "./pdfEngine";

import type React from "react";

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 8;
const PAGE_GAP = 12;
const SELECTION_HIGHLIGHT = "rgba(59, 130, 246, 0.35)";

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
          disabled={zoomState.currentZoomLevel <= MIN_ZOOM}
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
          disabled={zoomState.currentZoomLevel >= MAX_ZOOM}
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
 * Copies the current PDF selection on Cmd/Ctrl+C.
 *
 * The selection plugin tracks the selection but binds no shortcut — its own
 * `CopyToClipboard` only listens for a copy request that something else has to
 * raise. Bound to the document rather than a container because the page layers
 * are not focusable, so the keystroke never reaches them.
 */
const PdfCopyShortcut: React.FC<{ documentId: string }> = ({ documentId }) => {
  const { provides: selection } = useSelectionCapability();

  useEffect(() => {
    if (!selection) {
      return;
    }

    const scope = selection.forDocument(documentId);

    const onCopy = (event: Event) => {
      scope.getSelectedText().wait((lines) => {
        const text = Array.isArray(lines) ? lines.join("\n") : String(lines);
        if (!text) {
          return;
        }
        event.preventDefault();
        void copyTextToClipboard(text);
      }, ignoreCopyFailure);
    };

    document.addEventListener("copy", onCopy);
    return () => document.removeEventListener("copy", onCopy);
  }, [documentId, selection]);

  return null;
};

const ignoreCopyFailure = () => undefined;

const PAGE_ANCHOR = "#page=";

/**
 * Citations deep-link into a document as "…document.pdf#page=4" (see the
 * erato-file:// handling in MessageContent). The browser's own viewer honoured
 * that fragment; PDFium has to be told, and it wants the address without it.
 */
export function splitPageAnchor(url: string): {
  documentUrl: string;
  anchoredPage: number | null;
} {
  const anchorAt = url.lastIndexOf(PAGE_ANCHOR);
  if (anchorAt === -1) {
    return { documentUrl: url, anchoredPage: null };
  }

  const page = Number(url.slice(anchorAt + PAGE_ANCHOR.length));
  return {
    documentUrl: url.slice(0, anchorAt),
    anchoredPage: Number.isInteger(page) && page > 0 ? page : null,
  };
}

/**
 * Jumps to the citation's page once. Waits for the scroller's layout-ready
 * event rather than a page count: the count lands first, and a jump issued
 * before the virtual layout exists is silently dropped.
 */
const PdfPageAnchor: React.FC<{ documentId: string; page: number }> = ({
  documentId,
  page,
}) => {
  const { provides: scroll } = useScrollCapability();
  const jumpedRef = useRef(false);

  useEffect(() => {
    if (!scroll) {
      return;
    }

    return scroll.onLayoutReady((event) => {
      if (jumpedRef.current || event.documentId !== documentId) {
        return;
      }

      jumpedRef.current = true;
      scroll.forDocument(documentId).scrollToPage({
        pageNumber: Math.min(page, event.totalPages),
        behavior: "auto",
      });
    });
  }, [documentId, page, scroll]);

  return null;
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
  const { documentUrl, anchoredPage } = splitPageAnchor(url);

  useEffect(() => {
    if (!documentManager || openedUrlRef.current === documentUrl) {
      return;
    }

    const previousDocumentIds = documentManager
      .getOpenDocuments()
      .map((openDocument) => openDocument.id);
    openedUrlRef.current = documentUrl;
    setOpenFailed(false);

    const failOpen = () => {
      if (openedUrlRef.current === documentUrl) {
        setOpenFailed(true);
      }
    };

    // Always whole-file: the incremental mode needs range requests, which blob
    // URLs cannot serve at all and an auth proxy in front of a preview URL may
    // not either. Previewable files are size-capped, so the one-shot cost is
    // bounded and the behaviour is the same everywhere.
    documentManager
      .openDocumentUrl({ url: documentUrl, mode: "full-fetch" })
      .wait(
        (response) =>
          response.task.wait(() => {
            // Swapping attachments inside one email preview reuses this viewer,
            // so the superseded document has to give its PDFium memory back.
            previousDocumentIds.forEach((documentId) => {
              documentManager.closeDocument(documentId).wait(
                () => undefined,
                () => undefined,
              );
            });
          }, failOpen),
        failOpen,
      );
  }, [documentManager, documentUrl]);

  if (openFailed || activeDocument?.status === "error") {
    return <PdfPreviewError />;
  }

  if (!activeDocumentId || activeDocument?.status !== "loaded") {
    return <PdfPreviewLoading />;
  }

  return (
    <>
      {anchoredPage !== null && (
        <PdfPageAnchor documentId={activeDocumentId} page={anchoredPage} />
      )}
      <PdfCopyShortcut documentId={activeDocumentId} />
      <PdfToolbar documentId={activeDocumentId} />
      <Viewport
        documentId={activeDocumentId}
        className="min-h-0 flex-1 select-none overflow-auto bg-[var(--pdf-preview-surface-bg)]"
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
                {/*
                 * Both raster layers have to opt out of pointer events. The
                 * page image is an <img>, so a drag across it starts a native
                 * HTML5 image drag, and the pointercancel that follows kills
                 * the selection mid-gesture — it freezes on the first glyph.
                 * EmbedPDF v3 sets these upstream; v2 does not.
                 */}
                <RenderLayer
                  documentId={activeDocumentId}
                  pageIndex={pageIndex}
                  draggable={false}
                  style={{ position: "absolute", pointerEvents: "none" }}
                />
                <TilingLayer
                  documentId={activeDocumentId}
                  pageIndex={pageIndex}
                  style={{ pointerEvents: "none" }}
                />
                <SelectionLayer
                  documentId={activeDocumentId}
                  pageIndex={pageIndex}
                  textStyle={{ background: SELECTION_HIGHLIGHT }}
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
  // Building the engine is synchronous — it hands the worker a wasm URL and
  // returns; the compile happens over there. Unmounting tears the plugin
  // registry down, which closes the documents, but leaves the engine up for
  // the next preview.
  const [engine] = useState(getPdfEngine);

  return (
    <div
      className="pdf-preview-theme flex h-[75vh] flex-col overflow-hidden rounded-md border border-[var(--theme-border-muted)]"
      data-testid="file-preview-pdf"
    >
      <EmbedPDF engine={engine} plugins={PDF_PLUGINS}>
        <PdfDocument url={url} />
      </EmbedPDF>
    </div>
  );
};

// eslint-disable-next-line lingui/no-unlocalized-strings
PdfPreview.displayName = "PdfPreview";
