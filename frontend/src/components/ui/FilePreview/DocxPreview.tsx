import {
  ReactDocxViewer,
  setWasmSource,
  useDocxModel,
} from "@extend-ai/react-docx";
import docxWasmUrl from "@extend-ai/react-docx/docx_wasm_bg.wasm?url";
import { t } from "@lingui/core/macro";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/Controls/Button";
import { Alert } from "@/components/ui/Feedback/Alert";
import { FilePreviewLoading } from "@/components/ui/FileUpload/FilePreviewLoading";
import { MoonIcon, SunIcon } from "@/components/ui/icons";

import type React from "react";

type LoadState =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; buffer: ArrayBuffer };
type DocxTheme = "light" | "dark";

interface DocxPreviewProps {
  url: string;
}

setWasmSource(docxWasmUrl);

export const DocxPreview: React.FC<DocxPreviewProps> = ({ url }) => {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [docxTheme, setDocxTheme] = useState<DocxTheme>("light");
  const { model, isLoading, error } = useDocxModel(
    state.kind === "ready" ? state.buffer : undefined,
  );

  useEffect(() => {
    const controller = new AbortController();

    setState({ kind: "loading" });

    const load = async () => {
      try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) {
          throw new Error(`DOCX preview fetch failed: ${response.status}`);
        }
        setState({ kind: "ready", buffer: await response.arrayBuffer() });
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === "AbortError") {
          return;
        }
        setState({ kind: "error" });
      }
    };

    void load();

    return () => controller.abort();
  }, [url]);

  if (state.kind === "error" || error) {
    return (
      <div className="text-center" data-testid="file-preview-docx-error">
        <Alert type="warning" className="mb-4">
          {t({
            id: "filePreview.docxPreviewUnavailable",
            message: "Preview unavailable: this document could not be loaded.",
          })}
        </Alert>
      </div>
    );
  }

  if (state.kind === "loading" || isLoading || !model) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <FilePreviewLoading
          label={t({
            id: "filePreview.docxLoading",
            message: "Loading document preview...",
          })}
          description=""
        />
      </div>
    );
  }

  const isDarkDocxTheme = docxTheme === "dark";
  const toggleDocxThemeLabel = isDarkDocxTheme
    ? t({
        id: "filePreview.docxTheme.useLight",
        message: "Use light document theme",
      })
    : t({
        id: "filePreview.docxTheme.useDark",
        message: "Use dark document theme",
      });

  return (
    <div
      className="docx-preview-theme relative h-[75vh] overflow-hidden rounded-md border border-[var(--theme-border-muted)]"
      data-docx-theme={docxTheme}
      data-testid="file-preview-docx"
    >
      <div className="absolute right-3 top-3 z-10">
        <Button
          variant="icon-only"
          size="sm"
          aria-label={toggleDocxThemeLabel}
          aria-pressed={isDarkDocxTheme}
          className="border border-[var(--docx-preview-control-border)] bg-[var(--docx-preview-control-bg)] text-[var(--docx-preview-control-fg)] shadow-sm hover:bg-[var(--docx-preview-control-hover-bg)] hover:text-[var(--docx-preview-control-hover-fg)]"
          icon={
            isDarkDocxTheme ? (
              <SunIcon className="size-4" />
            ) : (
              <MoonIcon className="size-4" />
            )
          }
          onClick={() =>
            setDocxTheme((current) => (current === "dark" ? "light" : "dark"))
          }
        />
      </div>

      <div className="h-full overflow-auto px-4 pb-4 pt-14">
        <ReactDocxViewer
          model={model}
          className="min-w-max"
          emptyState={t({
            id: "filePreview.docxEmpty",
            message: "Document preview is empty.",
          })}
        />
      </div>
    </div>
  );
};

// eslint-disable-next-line lingui/no-unlocalized-strings
DocxPreview.displayName = "DocxPreview";
