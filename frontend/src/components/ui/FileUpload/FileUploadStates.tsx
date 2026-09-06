import { t } from "@lingui/core/macro";
import clsx from "clsx";
import { memo } from "react";

import { Button } from "../Controls";
import { CopyErrorButton } from "../Feedback/CopyErrorButton";
import { SpinnerIcon } from "../Feedback/SpinnerIcon";
import { ErrorIcon } from "../icons";

import type { CSSProperties } from "react";

// The button's icon slot is 20px, which falls between the 16 and 24 size
// steps.
const UPLOAD_RING_STYLE = {
  // eslint-disable-next-line lingui/no-unlocalized-strings
  "--spinner-size": "1.25rem",
} as CSSProperties;

/**
 * Props for the loading state component
 */
export interface FileUploadLoadingProps {
  /** Additional class name */
  className?: string;
  /** Custom label for accessibility */
  label?: string;
  /**
   * Shape of the control this stands in for, so swapping to it does not
   * change the button's size or fill. Defaults to the filled upload button.
   */
  variant?: "secondary" | "ghost";
}

export const FileUploadLoading = memo<FileUploadLoadingProps>(
  ({ className = "", label = t`Uploading file`, variant = "secondary" }) => (
    <Button
      disabled
      className={clsx("flex min-w-fit items-center justify-center", className)}
      aria-label={label}
      variant={variant}
    >
      <SpinnerIcon size="md" aria-hidden style={UPLOAD_RING_STYLE} />
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
    <div className="flex items-center gap-2">
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
      <CopyErrorButton error={error} iconOnly />
    </div>
  ),
);

// eslint-disable-next-line lingui/no-unlocalized-strings
FileUploadError.displayName = "FileUploadError";
