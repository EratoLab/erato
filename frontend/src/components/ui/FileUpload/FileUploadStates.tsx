import { t } from "@lingui/core/macro";
import { memo } from "react";

import { Button } from "../Controls";
import { LoadingIcon, ErrorIcon } from "../icons";

/**
 * Props for the loading state component
 */
export interface FileUploadLoadingProps {
  /** Additional class name */
  className?: string;
  /** Custom label for accessibility */
  label?: string;
}

export const FileUploadLoading = memo<FileUploadLoadingProps>(
  ({ className = "", label = t`Uploading file` }) => (
    <Button
      disabled
      className={className}
      aria-label={label}
      variant="secondary"
    >
      <LoadingIcon className="size-5 animate-spin text-[var(--theme-fg-muted)]" />
    </Button>
  ),
);

// eslint-disable-next-line lingui/no-unlocalized-strings
FileUploadLoading.displayName = "FileUploadLoading";

/**
 * Props for the error state component
 */
export interface FileUploadErrorProps {
  /** Error object to display */
  error: Error;
  /** Additional class name */
  className?: string;
}

export const FileUploadError = memo<FileUploadErrorProps>(
  ({ error, className = "" }) => (
    <Button
      disabled
      variant="danger"
      className={className}
      title={error.message}
      aria-label={`${t`Error:`} ${error.message}`}
    >
      {error.message}
      <ErrorIcon className="size-5 text-[var(--theme-error-fg)]" />
    </Button>
  ),
);

// eslint-disable-next-line lingui/no-unlocalized-strings
FileUploadError.displayName = "FileUploadError";
