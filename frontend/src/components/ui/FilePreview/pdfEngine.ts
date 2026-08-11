import { createPdfiumEngine } from "@embedpdf/engines/pdfium-worker-engine";
import pdfiumWasmUrl from "@embedpdf/pdfium/pdfium.wasm?url";

import type { PdfEngine } from "@embedpdf/models";

/**
 * PDFium runs in a worker EmbedPDF spawns from a `blob:` URL, and a blob
 * worker has no document base to resolve against — it rejects the
 * root-relative "/assets/…" path a bundled asset import produces with
 * "Failed to parse URL". Absolute is the only form that survives the hop.
 */
function absoluteWasmUrl(): string {
  return new URL(pdfiumWasmUrl, document.baseURI).href;
}

/**
 * EmbedPDF otherwise resolves both the PDFium binary and its fallback fonts
 * from cdn.jsdelivr.net. An air-gapped deployment cannot reach it, so the
 * binary is served from our own bundle and the font fallback is switched off —
 * the seven font packages behind it total ~150 MB, and PDFium substitutes its
 * built-in faces when a document does not embed one.
 */
export function createPdfEngine(): PdfEngine {
  return createPdfiumEngine(absoluteWasmUrl(), {
    fontFallback: null,
    // The image-encoder pool spawns its workers from a bundler-resolved module
    // URL rather than the inlined blob the engine itself uses, so it is the one
    // piece of this stack whose asset path has to survive the library build and
    // the add-in's re-bundle. A preview renders a handful of pages; encoding
    // them on the engine worker is worth not owning that resolution problem.
    encoderPoolSize: 0,
  });
}
