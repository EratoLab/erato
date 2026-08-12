import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "@/components/providers/ThemeProvider";

import { FilePreviewContent } from "./FilePreviewContent";

// Stands in for the lazy chunk failing to load — a deploy rotated the hashed
// filename under an already-open tab, or the network dropped.
vi.mock("./PdfPreview", () => {
  throw new Error("simulated chunk load failure");
});

describe("FilePreviewContent with an unreachable PDF chunk", () => {
  it("degrades to an inline error instead of taking the page down", async () => {
    // Nothing renders an error boundary above this in either host, so an
    // uncaught rejection here would unmount the whole React root.
    render(
      <ThemeProvider>
        <FilePreviewContent
          filename="report.pdf"
          url="https://files.example.com/download/report.pdf"
        />
      </ThemeProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("file-preview-pdf-error")).toBeInTheDocument(),
    );
    expect(
      screen.getByText(
        "Preview unavailable: this document could not be loaded.",
      ),
    ).toBeInTheDocument();
  });
});
