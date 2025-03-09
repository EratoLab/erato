import React, { memo } from "react";

import { FILE_PREVIEW_STYLES } from "./fileUploadStyles";

interface FileUploadProgressProps {
  /** Progress value from 0-100 */
  progress: number;
  /** CSS class name */
  className?: string;
}

/**
 * Progress bar for file uploads
 */
export const FileUploadProgress = memo<FileUploadProgressProps>(
  ({ progress, className = "" }) => {
    // Ensure progress is between 0-100
    const clampedProgress = Math.max(0, Math.min(100, progress));

    return (
      <div className={`${FILE_PREVIEW_STYLES.progress.container} ${className}`}>
        <div
          className={FILE_PREVIEW_STYLES.progress.bar}
          style={{ width: `${clampedProgress}%` }}
          role="progressbar"
          aria-valuenow={clampedProgress}
          aria-valuemin={0}
          aria-valuemax={100}
        ></div>
      </div>
    );
  },
);

FileUploadProgress.displayName = "FileUploadProgress";
