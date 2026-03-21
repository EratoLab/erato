import { t } from "@lingui/core/macro";
import { memo } from "react";

import { LoadingIcon } from "../icons";
import { FILE_PREVIEW_STYLES } from "./fileUploadStyles";

interface FilePreviewLoadingProps {
  /** Optional loading label */
  label?: string;
  /** Additional CSS class name */
  className?: string;
}

export const FilePreviewLoading = memo<FilePreviewLoadingProps>(
  ({ label = t`Loading file...`, className = "" }) => {
    return (
      <div
        className={`${FILE_PREVIEW_STYLES.container} ${className}`}
        aria-live="polite"
        aria-busy="true"
      >
        <div className="mr-2 shrink-0 text-[var(--theme-fg-muted)]">
          <LoadingIcon
            className={`${FILE_PREVIEW_STYLES.icon} animate-spin`}
            aria-hidden="true"
          />
        </div>

        <div className="min-w-0 flex-1">
          <div className={FILE_PREVIEW_STYLES.name}>{label}</div>
          <div className="text-xs text-[var(--theme-fg-muted)]">
            {t`Please wait`}
          </div>
        </div>
      </div>
    );
  },
);

// eslint-disable-next-line lingui/no-unlocalized-strings
FilePreviewLoading.displayName = "FilePreviewLoading";
