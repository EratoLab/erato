import { describe, expect, it, vi } from "vitest";

import { getPdfEngine } from "./pdfEngine";

const createPdfiumEngineMock = vi.hoisted(() =>
  vi.fn((_wasmUrl: string, _options: Record<string, unknown>) => ({})),
);

vi.mock("@embedpdf/engines/pdfium-worker-engine", () => ({
  createPdfiumEngine: createPdfiumEngineMock,
}));

describe("getPdfEngine", () => {
  it("hands PDFium an absolute same-origin wasm url and no CDN fonts", () => {
    getPdfEngine();

    expect(createPdfiumEngineMock).toHaveBeenCalledTimes(1);
    const [wasmUrl, options] = createPdfiumEngineMock.mock.calls[0];

    // EmbedPDF's defaults point the binary and the fallback fonts at
    // cdn.jsdelivr.net, which an air-gapped deployment cannot reach.
    expect(new URL(wasmUrl).origin).toBe(window.location.origin);
    expect(wasmUrl).toContain("pdfium");
    expect(options.fontFallback).toBeNull();

    // The engine's worker is spawned from a blob URL, where a root-relative
    // path fails to parse. Anything but an absolute URL breaks page rendering.
    expect(() => new URL(wasmUrl)).not.toThrow();
    expect(options.encoderPoolSize).toBe(0);
  });

  it("reuses one engine so repeat previews do not rebuild PDFium", () => {
    // Each build strands ~0.7 MB of un-revokable worker blob, and under the
    // library build re-decodes the binary from a base64 data URI.
    expect(getPdfEngine()).toBe(getPdfEngine());
    expect(createPdfiumEngineMock).toHaveBeenCalledTimes(1);
  });
});
