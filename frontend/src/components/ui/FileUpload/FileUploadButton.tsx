import React, { useRef, useState, useCallback, memo, Suspense } from "react";
import { ErrorBoundary } from "react-error-boundary";

import { useFileUpload } from "@/hooks/useFileUpload";
import { FileTypeUtil } from "@/utils/fileTypes";

import { PlusIcon } from "../icons";
import { FileUploadButtonError } from "./FileUploadButtonError";
import { FileUploadButtonLoading } from "./FileUploadButtonLoading";
import { BUTTON_STYLES } from "./fileUploadStyles";

import type { FileUploadItem } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { FileType } from "@/utils/fileTypes";

export interface FileUploadButtonProps {
  /** Callback when files are successfully uploaded */
  onFilesUploaded?: (files: FileUploadItem[]) => void;
  /** Array of accepted file types */
  acceptedFileTypes?: FileType[];
  /** Whether multiple files can be selected */
  multiple?: boolean;
  /** Custom button label */
  label?: string;
  /** Custom button className */
  className?: string;
  /** Whether the button is disabled */
  disabled?: boolean;
  /** Whether to show only the icon without text */
  iconOnly?: boolean;
}

// Inner component that can throw during loading
const FileUploadButtonInner = memo<FileUploadButtonProps>(
  ({
    onFilesUploaded,
    acceptedFileTypes = [],
    multiple = false,
    label = "Attach File",
    className = "",
    disabled = false,
    iconOnly = true,
  }) => {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [isHovered, setIsHovered] = useState(false);

    // Use our file upload hook
    const { uploadFiles, isUploading, error } = useFileUpload({
      onUploadSuccess: (files) => {
        onFilesUploaded?.(files);
        // Reset the file input so the same file can be selected again
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
      },
    });

    // Handle file selection with useCallback for better performance
    const handleFileSelect = useCallback(
      (event: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(event.target.files ?? []);
        if (files.length === 0) return;

        // Use void to explicitly ignore the promise
        void uploadFiles(files);
      },
      [uploadFiles],
    );

    // Trigger file input click with useCallback
    const handleButtonClick = useCallback(() => {
      fileInputRef.current?.click();
    }, []);

    // Handle hover states with useCallback
    const handleMouseEnter = useCallback(() => setIsHovered(true), []);
    const handleMouseLeave = useCallback(() => setIsHovered(false), []);

    // Generate accept string from accepted file types
    const acceptString = FileTypeUtil.getAcceptString(acceptedFileTypes);

    // Show loading state if uploading
    if (isUploading) {
      return <FileUploadButtonLoading />;
    }

    // Show error state if there was an error
    if (error) {
      return <FileUploadButtonError error={error} />;
    }

    // Compute button styles based on props and state
    const buttonStyles = [
      BUTTON_STYLES.base,
      iconOnly ? BUTTON_STYLES.iconOnly : BUTTON_STYLES.withLabel,
      isHovered ? BUTTON_STYLES.hover : BUTTON_STYLES.default,
      className,
    ].join(" ");

    const iconStyles = `size-5 ${isHovered ? "text-blue-500" : "text-[var(--theme-fg-muted)]"}`;

    return (
      <>
        <input
          type="file"
          ref={fileInputRef}
          className="hidden"
          accept={acceptString}
          multiple={multiple}
          onChange={handleFileSelect}
          disabled={disabled || isUploading}
          aria-hidden="true"
        />
        <button
          type="button"
          className={buttonStyles}
          onClick={handleButtonClick}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          disabled={disabled || isUploading}
          aria-label={iconOnly ? label : undefined}
        >
          <PlusIcon className={iconStyles} />
          {!iconOnly && <span>{label}</span>}
        </button>
      </>
    );
  },
);

FileUploadButtonInner.displayName = "FileUploadButtonInner";

/**
 * Button component for file uploads with Suspense support
 */
export const FileUploadButton = memo<FileUploadButtonProps>((props) => {
  return (
    <ErrorBoundary
      FallbackComponent={({ error }) => <FileUploadButtonError error={error} />}
      onReset={() => {
        // Reset the error state when the error boundary is reset
        // This is triggered when the user clicks a "try again" button in the fallback
      }}
    >
      <Suspense fallback={<FileUploadButtonLoading />}>
        <FileUploadButtonInner {...props} />
      </Suspense>
    </ErrorBoundary>
  );
});

FileUploadButton.displayName = "FileUploadButton";
