import { XlsxViewer } from "@extend-ai/react-xlsx";
import { t } from "@lingui/core/macro";
import { useState } from "react";

import { Button } from "@/components/ui/Controls/Button";
import { Alert } from "@/components/ui/Feedback/Alert";
import { FilePreviewLoading } from "@/components/ui/FileUpload/FilePreviewLoading";
import { MoonIcon, SunIcon } from "@/components/ui/icons";

import type React from "react";

type XlsxTheme = "light" | "dark";

interface XlsxPreviewProps {
  filename: string;
  url: string;
}

export const XlsxPreview: React.FC<XlsxPreviewProps> = ({ filename, url }) => {
  const [xlsxTheme, setXlsxTheme] = useState<XlsxTheme>("light");
  const isDarkXlsxTheme = xlsxTheme === "dark";
  const toggleXlsxThemeLabel = isDarkXlsxTheme
    ? t({
        id: "filePreview.xlsxTheme.useLight",
        message: "Use light spreadsheet theme",
      })
    : t({
        id: "filePreview.xlsxTheme.useDark",
        message: "Use dark spreadsheet theme",
      });

  return (
    <div
      className="xlsx-preview-theme flex h-[75vh] flex-col overflow-hidden rounded-md border border-[var(--theme-border-muted)]"
      data-testid="file-preview-xlsx"
      data-xlsx-theme={xlsxTheme}
    >
      <div className="flex h-12 shrink-0 items-center justify-end border-b border-[var(--xlsx-preview-control-border)] bg-[var(--xlsx-preview-control-bg)] px-3">
        <Button
          variant="icon-only"
          size="sm"
          aria-label={toggleXlsxThemeLabel}
          aria-pressed={isDarkXlsxTheme}
          className="border border-[var(--xlsx-preview-control-border)] bg-[var(--xlsx-preview-button-bg)] text-[var(--xlsx-preview-control-fg)] shadow-sm hover:bg-[var(--xlsx-preview-control-hover-bg)] hover:text-[var(--xlsx-preview-control-hover-fg)]"
          icon={
            isDarkXlsxTheme ? (
              <SunIcon className="size-4" />
            ) : (
              <MoonIcon className="size-4" />
            )
          }
          onClick={() =>
            setXlsxTheme((current) => (current === "dark" ? "light" : "dark"))
          }
        />
      </div>
      <div className="min-h-0 flex-1">
        <XlsxViewer
          src={url}
          fileName={filename}
          height="100%"
          readOnly
          isDark={isDarkXlsxTheme}
          showDefaultToolbar={false}
          useWorker={false}
          loadingState={
            <div className="flex h-full min-h-[50vh] items-center justify-center">
              <FilePreviewLoading
                label={t({
                  id: "filePreview.xlsxLoading",
                  message: "Loading spreadsheet preview...",
                })}
                description=""
              />
            </div>
          }
          errorState={
            <div
              className="p-4 text-center"
              data-testid="file-preview-xlsx-error"
            >
              <Alert type="warning" className="mb-4">
                {t({
                  id: "filePreview.xlsxPreviewUnavailable",
                  message:
                    "Preview unavailable: this spreadsheet could not be loaded.",
                })}
              </Alert>
            </div>
          }
          emptyState={t({
            id: "filePreview.xlsxEmpty",
            message: "Spreadsheet preview is empty.",
          })}
        />
      </div>
    </div>
  );
};

// eslint-disable-next-line lingui/no-unlocalized-strings
XlsxPreview.displayName = "XlsxPreview";
