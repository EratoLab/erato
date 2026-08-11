import { describe, expect, it, vi } from "vitest";

import { createPdfEngine } from "./pdfEngine";

const createPdfiumEngineMock = vi.hoisted(() =>
  vi.fn((_wasmUrl: string, _options: Record<string, unknown>) => ({})),
);

vi.mock("@embedpdf/engines/pdfium-worker-engine", () => ({
  createPdfiumEngine: createPdfiumEngineMock,
}));

describe("createPdfEngine", () => {
  it("hands PDFium an absolute same-origin wasm url and no CDN fonts", () => {
    createPdfEngine();

    expect(createPdfiumEngineMock).toHaveBeenCalledTimes(1);
    const [wasmUrl, options] = createPdfiumEngineMock.mock.calls[0];

    // EmbedPDF's defaults point the binary and the fallback fonts at
    // cdn.jsdelivr.net, which an air-gapped deployment cannot reach.
    expect(wasmUrl).not.toContain("//cdn.");
    expect(wasmUrl).toContain("pdfium");
    expect(options.fontFallback).toBeNull();

    // The engine's worker is spawned from a blob URL, where a root-relative
    // path fails to parse. Anything but an absolute URL breaks page rendering.
    expect(() => new URL(wasmUrl)).not.toThrow();
    expect(options.encoderPoolSize).toBe(0);
  });
});
