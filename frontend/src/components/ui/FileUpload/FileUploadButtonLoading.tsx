import React, { memo } from "react";

import { BUTTON_STYLES } from "./fileUploadStyles";

/**
 * Loading state for file upload button
 */
export const FileUploadButtonLoading = memo(() => (
  <button
    disabled
    className={BUTTON_STYLES.loading}
    aria-label="Uploading file"
  >
    <svg
      className="size-5 animate-spin text-[var(--theme-fg-muted)]"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      ></circle>
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      ></path>
    </svg>
  </button>
));

FileUploadButtonLoading.displayName = "FileUploadButtonLoading";
