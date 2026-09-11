import { render, screen, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { AssistantFileUploadSelector } from "../AssistantFileUploadSelector";

const MiB = 1024 * 1024;
const LIMIT = 20 * MiB;

vi.mock("@/providers/FeatureConfigProvider", () => ({
  useUploadFeature: () => ({
    enabled: true,
    maxSizeBytes: LIMIT,
    maxSizeFormatted: "20 MB",
  }),
  useCloudProvidersFeature: vi.fn(() => ({ availableProviders: [] })),
}));

vi.mock("@/hooks/files/useStandaloneFileUpload", () => ({
  useStandaloneFileUpload: () => ({
    uploadFiles: mockUploadFiles,
    isUploading: false,
    error: null,
    reset: vi.fn(),
  }),
}));

// Capture what react-dropzone is configured with so the selector's own hidden
// disk picker can be driven directly.
let capturedOnDrop: (
  accepted: File[],
  rejected: { file: File; errors: { code: string; message: string }[] }[],
) => void = () => {};
let capturedValidatorMaxSize: number | undefined;

vi.mock("react-dropzone", () => ({
  useDropzone: vi.fn((opts) => {
    capturedOnDrop = opts.onDrop ?? (() => {});
    capturedValidatorMaxSize = opts.maxSize;
    return {
      getRootProps: () => ({}),
      getInputProps: () => ({}),
      open: vi.fn(),
    };
  }),
}));

// The real Alert pulls in themed icons and needs a ThemeProvider; this test is
// about which error reaches it, not how it paints.
vi.mock("@/components/ui/Feedback/Alert", () => ({
  Alert: ({ children }: { children: React.ReactNode }) => (
    <div role="alert">{children}</div>
  ),
}));

const mockUploadFiles = vi.fn(async () => []);

function makeFileWithSize(name: string, size: number): File {
  const file = new File([], name, { type: "application/pdf" });
  Object.defineProperty(file, "size", { value: size });
  return file;
}

describe("AssistantFileUploadSelector", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes the configured limit to its hidden disk picker", () => {
    render(<AssistantFileUploadSelector onFilesUploaded={vi.fn()} />);

    expect(capturedValidatorMaxSize).toBe(LIMIT);
  });

  it("renders an oversized rejection in its own alert, naming the file", () => {
    render(<AssistantFileUploadSelector onFilesUploaded={vi.fn()} />);

    act(() => {
      capturedOnDrop(
        [],
        [
          {
            file: makeFileWithSize("huge.pdf", LIMIT + 1),
            errors: [{ code: "file-too-large", message: "too large" }],
          },
        ],
      );
    });

    // This selector renders `combinedError`, not the shared upload store, so
    // the rejection has to reach its own alert to be visible at all.
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("huge.pdf");
    expect(alert).toHaveTextContent("20 MB");
    expect(mockUploadFiles).not.toHaveBeenCalled();
  });

  it("renders a wrong-type rejection in its own alert and still uploads the rest", () => {
    render(<AssistantFileUploadSelector onFilesUploaded={vi.fn()} />);

    const accepted = makeFileWithSize("fine.pdf", 100);
    act(() => {
      capturedOnDrop(
        [accepted],
        [
          {
            file: makeFileWithSize("wrong.exe", 100),
            errors: [{ code: "file-invalid-type", message: "type" }],
          },
        ],
      );
    });

    expect(screen.getByRole("alert")).toHaveTextContent("wrong.exe");
    expect(mockUploadFiles).toHaveBeenCalledWith([accepted]);
  });

  it("still uploads a batch that is within the limit", () => {
    render(<AssistantFileUploadSelector onFilesUploaded={vi.fn()} />);

    act(() => {
      capturedOnDrop([makeFileWithSize("ok.pdf", LIMIT)], []);
    });

    expect(mockUploadFiles).toHaveBeenCalledTimes(1);
  });
});
