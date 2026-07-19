import { ReactPptxViewer, setWasmSource } from "@extend-ai/react-pptx";
import pptxWasmUrl from "@extend-ai/react-pptx/pptx_wasm_bg.wasm?url";
import "@extend-ai/react-pptx/styles.css";
import { t } from "@lingui/core/macro";

import { Alert } from "@/components/ui/Feedback/Alert";
import { FilePreviewLoading } from "@/components/ui/FileUpload/FilePreviewLoading";

import type React from "react";

interface PptxPreviewProps {
  url: string;
}

setWasmSource(pptxWasmUrl);

export const PptxPreview: React.FC<PptxPreviewProps> = ({ url }) => (
  <div
    className="pptx-preview-theme h-[75vh] overflow-hidden rounded-md"
    data-testid="file-preview-pptx"
  >
    <ReactPptxViewer
      source={url}
      mode="slide"
      height="100%"
      showToolbar
      showThumbnails
      renderLoading={() => (
        <FilePreviewLoading
          label={t({
            id: "filePreview.pptxLoading",
            message: "Loading presentation preview...",
          })}
          description=""
        />
      )}
      renderError={() => (
        <div className="p-4 text-center" data-testid="file-preview-pptx-error">
          <Alert type="warning" className="mb-4">
            {t({
              id: "filePreview.pptxPreviewUnavailable",
              message:
                "Preview unavailable: this presentation could not be loaded.",
            })}
          </Alert>
        </div>
      )}
      emptyState={t({
        id: "filePreview.pptxEmpty",
        message: "Presentation preview is empty.",
      })}
    />
  </div>
);

// eslint-disable-next-line lingui/no-unlocalized-strings
PptxPreview.displayName = "PptxPreview";
