import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

import { UploadTooLargeError } from "@/hooks/files/errors";
import { useFileUploadStore } from "@/hooks/files/useFileUploadStore";
import { makeFileWithSize } from "@/test/fileFixtures";

import { FileUploadButton } from "../FileUploadButton";

const MiB = 1024 * 1024;
const DEFAULT_LIMIT = 20 * MiB;

vi.mock("@/providers/FeatureConfigProvider", () => ({
  useUploadFeature: vi.fn(() => ({
    enabled: true,
    maxSizeBytes: DEFAULT_LIMIT,
    maxSizeFormatted: "20 MB",
  })),
}));

// Capture the onDrop and maxSize that react-dropzone receives
let capturedOnDrop: (
  accepted: File[],
  rejected: { file: File; errors: { code: string; message: string }[] }[],
) => void = () => {};
let capturedMaxSize: number | undefined;

vi.mock("react-dropzone", () => ({
  useDropzone: vi.fn((opts) => {
    capturedOnDrop = opts.onDrop ?? (() => {});
    capturedMaxSize = opts.maxSize;
    return {
      getRootProps: vi.fn(() => ({})),
      getInputProps: vi.fn(() => ({})),
      open: vi.fn(),
    };
  }),
}));

/**
 * The idle button used to be a hand-rolled <button> whose hover swapped in a
 * hardcoded `bg-blue-100` / `text-blue-500` via React state — unreachable by
 * any theme token. These pin the shared-Button geometry and the absence of
 * palette literals, so a regression shows up here rather than in a theme.
 */
describe("FileUploadButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useFileUploadStore.getState().reset();
    capturedOnDrop = () => {};
    capturedMaxSize = undefined;
  });

  it("uses shared icon geometry sized to match its composer siblings", () => {
    render(<FileUploadButton label="Attach" iconOnly />);

    const button = screen.getByRole("button", { name: "Attach" });

    expect(button).toHaveAttribute("data-geometry", "icon-sm");
    expect(button).toHaveAttribute("data-variant", "secondary");
    expect(button.className).toContain("btn-geometry-icon-sm");
  });

  it("uses control geometry and renders the label when not icon-only", () => {
    render(<FileUploadButton label="Attach files" iconOnly={false} />);

    const button = screen.getByRole("button", { name: /Attach files/ });

    expect(button).toHaveAttribute("data-geometry", "md");
    expect(screen.getByText("Attach files")).toBeInTheDocument();
  });

  it("carries no hardcoded palette colours", () => {
    render(<FileUploadButton label="Attach" iconOnly />);

    const button = screen.getByRole("button", { name: "Attach" });

    expect(button.className).not.toMatch(/\bbg-blue-/);
    expect(button.className).not.toMatch(/\btext-blue-/);
    expect(button.innerHTML).not.toMatch(/text-blue-/);
    // The fill comes from the variant's tokens.
    expect(button.className).toContain("bg-theme-bg-secondary");
    expect(button.className).toContain("hover:bg-theme-bg-hover");
  });

  it("is disabled when the disabled prop is set", () => {
    render(<FileUploadButton label="Attach" iconOnly disabled />);

    expect(screen.getByRole("button", { name: "Attach" })).toBeDisabled();
  });

  describe("file size enforcement", () => {
    it("passes the configured maxSize from useUploadFeature to useDropzone", () => {
      render(<FileUploadButton label="Attach" iconOnly />);
      expect(capturedMaxSize).toBe(DEFAULT_LIMIT);
    });

    it("calls onError with UploadTooLargeError when a file-too-large rejection arrives", () => {
      const onError = vi.fn();
      render(<FileUploadButton label="Attach" iconOnly onError={onError} />);

      const rejection = {
        file: makeFileWithSize("big.bin", DEFAULT_LIMIT + 1),
        errors: [{ code: "file-too-large", message: "File is too large" }],
      };
      capturedOnDrop([], [rejection]);

      expect(onError).toHaveBeenCalledTimes(1);
      const err = onError.mock.calls[0][0];
      expect(err).toBeInstanceOf(UploadTooLargeError);
      expect(err.message).toContain("20 MB");
    });

    it("does not invoke performFileUpload when a size rejection occurs", () => {
      const performFileUpload = vi.fn();
      const onError = vi.fn();
      render(
        <FileUploadButton
          label="Attach"
          iconOnly
          performFileUpload={performFileUpload}
          onError={onError}
        />,
      );

      const rejection = {
        file: makeFileWithSize("big.bin", DEFAULT_LIMIT + 1),
        errors: [{ code: "file-too-large", message: "File is too large" }],
      };
      capturedOnDrop([], [rejection]);

      expect(performFileUpload).not.toHaveBeenCalled();
    });

    it("does not call onError when there are no rejections (valid drop)", () => {
      // Verify the rejection handler is NOT triggered for a valid (non-oversized)
      // drop by inspecting the captured callback directly.
      const onError = vi.fn();
      render(<FileUploadButton label="Attach" iconOnly onError={onError} />);

      // No rejections → onError must not fire
      capturedOnDrop([], []);

      expect(onError).not.toHaveBeenCalled();
    });

    it("falls back to the shared upload store when no onError is supplied", () => {
      // `maxSize` keeps the file out of `acceptedFiles`, so `performFileUpload`
      // can never report it. Without a default sink the rejection is invisible:
      // no upload, no error, nothing — which is what the composer's attach
      // button and the assistant picker used to do.
      const performFileUpload = vi.fn();
      render(
        <FileUploadButton
          label="Attach"
          iconOnly
          performFileUpload={performFileUpload}
        />,
      );

      capturedOnDrop(
        [],
        [
          {
            file: makeFileWithSize("huge.bin", DEFAULT_LIMIT + 1),
            errors: [{ code: "file-too-large", message: "File is too large" }],
          },
        ],
      );

      const storeError = useFileUploadStore.getState().error;
      expect(storeError).toBeInstanceOf(UploadTooLargeError);
      expect(storeError?.message).toContain("20 MB");
      expect(storeError?.message).toContain("huge.bin");
      expect(performFileUpload).not.toHaveBeenCalled();
    });
  });
});
